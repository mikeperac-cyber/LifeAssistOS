import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GitHubService, GitHubSettingsStore, GITHUB_API_VERSION, isAllowedGitHubRequest, type GitHubRequest } from '../src/core/github'
import { createGitHubTools } from '../src/tools/github'
import type { SecretCodec } from '../src/core/settings'
import type { ResponseBody } from '../src/tools/web'

let dir = ''
let file = ''

const codec: SecretCodec = {
  available: true,
  encrypt: async (value) => Buffer.from(`encrypted:${value}`, 'utf8').toString('base64'),
  decrypt: async (value) => ({ value: Buffer.from(value, 'base64').toString('utf8').replace(/^encrypted:/, '') })
}

function response(body: unknown, status = 200, contentType = 'application/json; charset=utf-8'): ResponseBody {
  return { status, contentType, text: JSON.stringify(body) }
}

function signal(): AbortSignal {
  return new AbortController().signal
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-github-'))
  file = path.join(dir, 'github.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('GitHubSettingsStore', () => {
  it('encrypts the token and exposes only safe public state', async () => {
    const store = new GitHubSettingsStore(file, codec)
    await store.init()
    const publicSettings = await store.updateToken('github-secret-token')
    const raw = await readFile(file, 'utf8')

    expect(publicSettings).toEqual({ hasToken: true, tokenStored: true, ready: true })
    expect(JSON.stringify(publicSettings)).not.toContain('github-secret-token')
    expect(raw).toContain('tokenEnc')
    expect(raw).not.toContain('github-secret-token')

    const reloaded = new GitHubSettingsStore(file, codec)
    await reloaded.init()
    expect(reloaded.getToken()).toBe('github-secret-token')
  })

  it('keeps a token in memory only when OS encryption is unavailable', async () => {
    const store = new GitHubSettingsStore(file)
    await store.init()
    await store.updateToken('session-only-github-token')
    expect(store.getToken()).toBe('session-only-github-token')
    expect(store.public()).toEqual({ hasToken: true, tokenStored: false, ready: true })
    expect(await readFile(file, 'utf8')).not.toContain('session-only-github-token')
  })

  it('preserves encrypted material while the keychain is unavailable, then recovers it', async () => {
    const original = new GitHubSettingsStore(file, codec)
    await original.init()
    await original.updateToken('recoverable-github-token')

    const unavailable = new GitHubSettingsStore(file)
    await unavailable.init()
    expect(unavailable.public()).toEqual({ hasToken: true, tokenStored: true, ready: false })

    const recovered = new GitHubSettingsStore(file, codec)
    await recovered.init()
    expect(recovered.getToken()).toBe('recoverable-github-token')
  })

  it('clears the token and rejects malformed input without applying it', async () => {
    const store = new GitHubSettingsStore(file, codec)
    await store.init()
    await store.updateToken('valid-github-token')
    await store.updateToken(null)
    expect(store.public()).toEqual({ hasToken: false, tokenStored: false, ready: false })
    await expect(store.updateToken('short')).rejects.toThrow(/valid GitHub token/)
    await expect(store.updateToken('unsafe\r\ntokenvalue')).rejects.toThrow(/valid GitHub token/)
    expect(store.getToken()).toBeUndefined()
  })
})

describe('GitHubService', () => {
  async function configuredStore(): Promise<GitHubSettingsStore> {
    const store = new GitHubSettingsStore(file, codec)
    await store.init()
    await store.updateToken('integration-secret-token')
    return store
  }

  it('searches fixed read-only routes and bounds untrusted results', async () => {
    const calls: Array<{ url: URL; options: Parameters<GitHubRequest>[2] }> = []
    const service = new GitHubService(await configuredStore(), {
      request: async (url, _signal, options) => {
        calls.push({ url, options })
        return response({
          total_count: 3,
          incomplete_results: false,
          items: [
            {
              html_url: 'https://github.com/acme/project/issues/8',
              repository_url: 'https://api.github.com/repos/acme/project',
              number: 8,
              title: 'Bug report',
              body: 'A bug with a controlled preview.',
              state: 'open',
              updated_at: '2026-11-04T12:00:00Z',
              labels: [{ name: 'bug' }]
            },
            {
              html_url: 'https://github.com/acme/project/pull/9',
              repository_url: 'https://api.github.com/repos/acme/project',
              number: 9,
              title: 'A pull request',
              pull_request: { url: 'https://api.github.com/repos/acme/project/pulls/9' }
            },
            {
              html_url: 'https://attacker.example/acme/project/issues/10',
              repository_url: 'https://api.github.com/repos/acme/project',
              number: 10,
              title: 'Unsafe link'
            }
          ]
        })
      }
    })

    const result = await service.search('issues', 'bug report', 5, 1, signal())

    expect(result.items).toEqual([{
      type: 'issue',
      title: 'Bug report',
      url: 'https://github.com/acme/project/issues/8',
      repository: 'acme/project',
      bodyPreview: 'A bug with a controlled preview.',
      state: 'open',
      number: 8,
      updatedAt: '2026-11-04T12:00:00Z',
      labels: ['bug']
    }])
    expect(result.totalCount).toBe(3)
    expect(result.note).toContain('untrusted')
    expect(calls[0].url.origin).toBe('https://api.github.com')
    expect(calls[0].url.pathname).toBe('/search/issues')
    expect(calls[0].url.searchParams.get('q')).toBe('bug report is:issue')
    expect(calls[0].options.method).toBe('GET')
    expect(calls[0].options.headers).toMatchObject({
      Authorization: 'Bearer integration-secret-token',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION
    })
    expect(calls[0].options.maxResponseBytes).toBeLessThanOrEqual(512_000)
    expect(isAllowedGitHubRequest(calls[0].url, 'GET')).toBe(true)
  })

  it('keeps repository links on github.com and sends repository searches to the fixed route', async () => {
    const calls: URL[] = []
    const service = new GitHubService(await configuredStore(), {
      request: async (url) => {
        calls.push(url)
        return response({ items: [{
          html_url: 'https://github.com/acme/project',
          full_name: 'acme/project',
          description: 'A repository',
          stargazers_count: 4,
          language: 'TypeScript',
          updated_at: '2026-11-04T12:00:00Z'
        }] })
      }
    })
    const result = await service.search('repositories', 'project', 2, 1, signal())
    expect(calls[0].pathname).toBe('/search/repositories')
    expect(result.items[0]).toMatchObject({ type: 'repository', title: 'acme/project', stars: 4, language: 'TypeScript' })
  })

  it('rejects invalid queries, pages, routes, and off-site result links', async () => {
    let requestCount = 0
    const service = new GitHubService(await configuredStore(), {
      request: async () => { requestCount += 1; return response({ items: [] }) }
    })
    await expect(service.search('issues', ' ', 1, 1, signal())).rejects.toThrow(/query between 2 and 220/)
    await expect(service.search('issues', 'bug', 11, 1, signal())).rejects.toThrow(/between 1 and 10/)
    expect(requestCount).toBe(0)

    expect(isAllowedGitHubRequest(new URL('https://evil.example/search/issues?q=bug&page=1&per_page=1'), 'GET')).toBe(false)
    expect(isAllowedGitHubRequest(new URL('https://api.github.com:444/search/issues?q=bug&page=1&per_page=1'), 'GET')).toBe(false)
    expect(isAllowedGitHubRequest(new URL('https://api.github.com/search/issues?q=%0A&page=1&per_page=1'), 'GET')).toBe(false)
    expect(isAllowedGitHubRequest(new URL('https://api.github.com/search/issues?q=x&page=1&per_page=1'), 'GET')).toBe(false)
    expect(isAllowedGitHubRequest(new URL('https://api.github.com/search/issues?q=bug&page=1&per_page=1#fragment'), 'GET')).toBe(false)
    expect(isAllowedGitHubRequest(new URL('https://api.github.com/search/issues?q=bug&page=1&per_page=1'), 'DELETE')).toBe(false)
  })

  it('returns safe authentication errors and never requests without a token', async () => {
    const noToken = new GitHubService(new GitHubSettingsStore(file), {
      request: async () => { throw new Error('request should not run') }
    })
    await expect(noToken.search('issues', 'bug', 1, 1, signal())).rejects.toThrow(/Add a GitHub token/)

    const service = new GitHubService(await configuredStore(), { request: async () => response({}, 401) })
    await expect(service.search('issues', 'bug', 1, 1, signal())).rejects.toThrow(/GitHub rejected the token/)
  })

  it('keeps every search tool call externally scoped and approval-gated', async () => {
    const service = new GitHubService(await configuredStore(), { request: async () => response({ items: [] }) })
    const [search] = createGitHubTools(service)
    const args = { kind: 'pull_requests' as const, query: 'cache update', pageSize: 2, page: 1 }
    const scope = search.scope?.(args, {} as never)
    expect(search.risk).toBe('external')
    expect(search.sessionApprovalAllowed).toBe(false)
    expect(scope).toMatchObject({ kind: 'url', host: 'api.github.com' })
    expect(new URL((scope as { url: string }).url).searchParams.get('q')).toBe('cache update is:pull-request')
    expect(search.description).toContain('Requires approval for every request')
    expect(search.preview?.(args, { kind: 'none', signal: signal() })).toContain('query is sent to GitHub')
    expect(search.input.safeParse(args).success).toBe(true)
  })
})
