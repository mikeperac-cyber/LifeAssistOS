import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

async function collectFiles(dir: string, extPattern: RegExp): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const results: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...(await collectFiles(full, extPattern)))
    } else if (extPattern.test(entry.name)) {
      results.push(full)
    }
  }
  return results
}

describe('IPC & bundle boundary contract', () => {
  it('registers an exact 1-to-1 match between preload ipcRenderer.invoke channels and main ipcMain.handle channels with no duplicates', async () => {
    const preloadSource = await readFile(path.resolve('src/preload/index.ts'), 'utf8')
    const mainFiles = await collectFiles(path.resolve('src/main'), /\.ts$/)
    const mainSources = await Promise.all(mainFiles.map((file) => readFile(file, 'utf8')))

    const invokeRegex = /ipcRenderer\.invoke\(\s*'([^']+)'/g
    const handleRegex = /ipcMain\.handle\(\s*'([^']+)'/g

    const preloadChannels = [...preloadSource.matchAll(invokeRegex)].map((m) => m[1])
    const mainChannels = mainSources.flatMap((src) => [...src.matchAll(handleRegex)].map((m) => m[1]))

    // Check for duplicate ipcMain.handle registrations
    const counts = new Map<string, number>()
    for (const ch of mainChannels) {
      counts.set(ch, (counts.get(ch) ?? 0) + 1)
    }
    const duplicates = [...counts.entries()].filter(([, count]) => count > 1).map(([ch]) => ch)
    expect(duplicates).toEqual([])

    const preloadSet = [...new Set(preloadChannels)].sort()
    const mainSet = [...new Set(mainChannels)].sort()
    expect(mainSet).toEqual(preloadSet)
    expect(mainSet.length).toBeGreaterThan(0)
  })

  it('keeps renderer code free of node:* and core/* imports so the sandboxed browser bundle never externalizes Node builtins', async () => {
    const rendererFiles = await collectFiles(path.resolve('src/renderer'), /\.(ts|tsx)$/)
    const violations: string[] = []

    for (const file of rendererFiles) {
      const content = await readFile(file, 'utf8')
      if (/from\s+['"]node:/.test(content) || /from\s+['"][^'"]*\/core\//.test(content)) {
        violations.push(path.relative(process.cwd(), file))
      }
    }

    expect(violations).toEqual([])
  })
})
