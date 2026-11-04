import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { ToolDef } from '../shared/types'
import { resolveGrantPath, ToolError } from './paths'

const projectInput = z.object({
  root: z.string().optional().describe('Approved project folder; defaults to Workspace.'),
  path: z.string().optional().describe('Relative project subfolder to inspect.'),
  maxFiles: z.number().int().min(20).max(300).optional()
})

type ProjectArgs = z.infer<typeof projectInput>

interface ProjectFile {
  path: string
  size: number
  kind: 'instruction' | 'source' | 'manifest' | 'documentation' | 'test' | 'other'
}

interface ProjectOverview {
  root: string
  path: string
  stack: string[]
  fileCount: number
  files: ProjectFile[]
  instructionFiles: string[]
  instructionFilesTruncated: boolean
  keyFiles: string[]
  skippedLargeFiles: string[]
  truncated: boolean
}

const EXCLUDED_DIRECTORIES = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'vendor', 'dist', 'build', 'release',
  'coverage', '.next', '.nuxt', '.cache', '.venv', 'venv', 'target', 'bin', 'obj'
])

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java',
  '.cs', '.cpp', '.c', '.h', '.hpp', '.dart', '.swift', '.kt', '.vue', '.svelte',
  '.html', '.css', '.scss'
])
const OFFICE_DOCUMENT_EXTENSIONS = new Set(['.pdf', '.docx', '.xlsx'])
const OFFICE_DOCUMENT_LIMIT = 25_000_000
const MAX_INSTRUCTION_FILES = 20

const ROOT_INSTRUCTION_NAMES = new Set([
  'agents.md', 'claude.md', 'gemini.md', 'soul.md', '.hermes.md', '.cursorrules'
])

const MANIFEST_NAMES = new Set([
  'package.json', 'tsconfig.json', 'pyproject.toml', 'requirements.txt', 'cargo.toml',
  'go.mod', 'pom.xml', 'build.gradle', 'pubspec.yaml', 'composer.json', 'makefile'
])

export const projectOverviewTool: ToolDef<ProjectArgs, ProjectOverview> = {
  name: 'project_overview',
  description:
    'Map an approved project folder: identify its stack, repository instruction files, source/tests, manifests, and the most useful files to inspect next. This tool is read-only.',
  risk: 'read',
  input: projectInput,
  async scope(args, context) {
    const grant = context.grants.get(args.root)
    const resolved = await resolveGrantPath(grant, args.path ?? '.')
    return {
      kind: 'path',
      grantId: grant.id,
      grantLabel: grant.label,
      path: resolved.path,
      relative: resolved.relative
    }
  },
  async run(args, context) {
    if (context.kind !== 'path') throw new ToolError('Project inspection requires an approved folder.')
    const maxFiles = args.maxFiles ?? 160
    const files: ProjectFile[] = []
    const skippedLargeFiles: string[] = []
    let truncated = false

    const visit = async (directory: string, depth: number): Promise<void> => {
      if (depth > 7 || files.length >= maxFiles) {
        truncated = true
        return
      }

      let entries
      try {
        entries = await readdir(directory, { withFileTypes: true })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
        throw error
      }

      entries.sort((left, right) => left.name.localeCompare(right.name))
      for (const entry of entries) {
        if (files.length >= maxFiles) {
          truncated = true
          break
        }
        const absolute = path.join(directory, entry.name)
        const relative = path.relative(context.path, absolute)
        const relativePosix = relative.replace(/\\/g, '/')

        if (entry.name.startsWith('.') && entry.name !== '.env.example') {
          const isRelevantHiddenPath = entry.isDirectory()
            ? isInstructionDirectory(relativePosix)
            : isInstructionFile(relativePosix)
          if (!isRelevantHiddenPath) continue
        }

        if (entry.isDirectory()) {
          if (!EXCLUDED_DIRECTORIES.has(entry.name.toLowerCase()) &&
            (!relativePosix.startsWith('.') || isInstructionDirectory(relativePosix))) {
            await visit(absolute, depth + 1)
          }
          continue
        }
        if (!entry.isFile() || isSecretLike(entry.name)) continue

        const extension = path.extname(entry.name).toLowerCase()
        const lowerName = entry.name.toLowerCase()
        const kind = classifyFile(lowerName, extension, relativePosix)
        if (!kind) continue

        const info = await stat(absolute).catch(() => null)
        if (!info?.isFile()) continue
        if (info.size > projectFileReadLimit(relative)) skippedLargeFiles.push(relative)
        files.push({ path: relative, size: info.size, kind })
      }
    }

    await visit(context.path, 0)
    const stack = detectStack(files.map((file) => path.basename(file.path).toLowerCase()))
    const { instructionFiles, instructionFilesTruncated, keyFiles } = selectKeyFiles(files)

    return {
      root: context.grant.label,
      path: context.relative,
      stack,
      fileCount: files.length,
      keyFiles,
      instructionFiles,
      instructionFilesTruncated,
      skippedLargeFiles: skippedLargeFiles.slice(0, 40),
      truncated,
      files: files.slice(0, 100)
    }
  }
}

function classifyFile(name: string, extension: string, relativePath: string): ProjectFile['kind'] | null {
  if (isInstructionFile(relativePath)) return 'instruction'
  if (MANIFEST_NAMES.has(name)) return 'manifest'
  if (OFFICE_DOCUMENT_EXTENSIONS.has(extension)) return 'documentation'
  if (name.startsWith('readme') || ['.md', '.rst', '.txt'].includes(extension)) return 'documentation'
  if (/(^|[._-])(test|spec)([._-]|$)/i.test(name) || /(^|[\\/])tests?[\\/]/i.test(name)) return 'test'
  if (SOURCE_EXTENSIONS.has(extension)) return 'source'
  return null
}

function selectKeyFiles(files: ProjectFile[]): {
  instructionFiles: string[]
  instructionFilesTruncated: boolean
  keyFiles: string[]
} {
  const instructions = files
    .filter((file) => file.kind === 'instruction' && file.size <= projectFileReadLimit(file.path))
    .sort((left, right) => pathDepth(left.path) - pathDepth(right.path) || left.path.localeCompare(right.path))
  const instructionFiles = instructions.slice(0, MAX_INSTRUCTION_FILES).map((file) => file.path)

  const priority = (file: ProjectFile): number => {
    const name = path.basename(file.path).toLowerCase()
    if (name.startsWith('readme')) return 0
    if (file.kind === 'manifest') return 1
    if (file.kind === 'source') return 2
    if (file.kind === 'test') return 3
    return 4
  }

  const regularFiles = files
    .filter((file) => file.kind !== 'instruction' && file.size <= projectFileReadLimit(file.path))
    .sort((left, right) => priority(left) - priority(right) || left.path.localeCompare(right.path))
    .slice(0, 5)
    .map((file) => file.path)

  return {
    instructionFiles,
    instructionFilesTruncated: instructions.length > MAX_INSTRUCTION_FILES,
    keyFiles: [...instructionFiles, ...regularFiles]
  }
}

function isInstructionFile(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/').toLowerCase()
  const basename = path.posix.basename(normalized)
  if (ROOT_INSTRUCTION_NAMES.has(basename)) return true
  return normalized === '.github/copilot-instructions.md' ||
    /^\.github\/instructions\/[^/]+\.instructions\.md$/.test(normalized) ||
    /^\.cursor\/rules\/[^/]+\.md$/.test(normalized)
}

function isInstructionDirectory(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/').toLowerCase().replace(/\/$/, '')
  return normalized === '.github' || normalized === '.github/instructions' ||
    normalized === '.cursor' || normalized === '.cursor/rules'
}

function pathDepth(filePath: string): number {
  return filePath.split(/[\\/]+/).filter(Boolean).length
}

function projectFileReadLimit(filePath: string): number {
  return OFFICE_DOCUMENT_EXTENSIONS.has(path.extname(filePath).toLowerCase())
    ? OFFICE_DOCUMENT_LIMIT
    : 64_000
}

function detectStack(names: string[]): string[] {
  const stack = new Set<string>()
  if (names.includes('package.json')) stack.add('JavaScript/TypeScript')
  if (names.includes('pyproject.toml') || names.includes('requirements.txt')) stack.add('Python')
  if (names.includes('cargo.toml')) stack.add('Rust')
  if (names.includes('go.mod')) stack.add('Go')
  if (names.some((name) => name.endsWith('.csproj'))) stack.add('.NET/C#')
  if (names.includes('pubspec.yaml')) stack.add('Dart/Flutter')
  if (names.includes('pom.xml') || names.includes('build.gradle')) stack.add('Java/JVM')
  if (names.includes('composer.json')) stack.add('PHP')
  return stack.size > 0 ? [...stack] : ['Unclassified project']
}

function isSecretLike(name: string): boolean {
  return /(^|\.)env$|\.pem$|\.key$|\.p12$|\.pfx$|credentials|secrets?/i.test(name)
}
