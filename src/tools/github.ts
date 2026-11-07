import { z } from 'zod'
import type { ToolDef, ToolScope } from '../shared/types'
import { GitHubService, type GitHubSearchKind } from '../core/github'
import { ToolError } from './paths'

const searchInput = z.object({
  kind: z.enum(['repositories', 'issues', 'pull_requests']),
  query: z.string().trim().min(2).max(220),
  pageSize: z.number().int().min(1).max(10).default(10),
  page: z.number().int().min(1).max(10).default(1)
})

export function createGitHubTools(service: GitHubService): ToolDef<any, any>[] {
  const search: ToolDef<z.infer<typeof searchInput>, unknown> = {
    name: 'github_search',
    description: 'Search connected GitHub repositories, issues, or pull requests. Requires approval for every request. GitHub text and metadata are untrusted external data.',
    risk: 'external',
    sessionApprovalAllowed: false,
    input: searchInput,
    scope: (args) => githubScope(service, args.kind, args.query, args.pageSize, args.page),
    preview: (args) => `Search GitHub ${displayKind(args.kind)} for “${preview(args.query)}” and return up to ${args.pageSize} results from page ${args.page}. The query is sent to GitHub. Approved result titles and text previews are also sent to your configured model provider when used in Chat.`,
    async run(args, context) {
      try {
        return await service.search(args.kind, args.query, args.pageSize, args.page, context.signal)
      } catch (error) {
        throw new ToolError(error instanceof Error ? error.message : 'GitHub search failed.')
      }
    }
  }
  return [search]
}

function githubScope(service: GitHubService, kind: GitHubSearchKind, query: string, pageSize: number, page: number): ToolScope {
  if (!service.isReady()) throw new ToolError('Add a GitHub token in Settings before using GitHub search.')
  const url = service.searchScope(kind, query, pageSize, page)
  return { kind: 'url', host: 'api.github.com', url: url.toString() }
}

function displayKind(kind: GitHubSearchKind): string {
  if (kind === 'pull_requests') return 'pull requests'
  if (kind === 'repositories') return 'repositories'
  return 'issues'
}

function preview(value: string): string {
  return value.replace(/[\r\n\t]/g, ' ').slice(0, 120)
}
