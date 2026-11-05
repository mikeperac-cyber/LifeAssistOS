export interface ExternalPopupPolicyOptions {
  isAllowedDomain?: (hostname: string) => boolean
  isSavedResearchUrl?: (url: string) => boolean
}

export function resolveExternalPopupUrl(
  rawUrl: string,
  options: ExternalPopupPolicyOptions = {}
): string | null {
  try {
    const external = new URL(rawUrl)
    if (external.protocol !== 'https:') return null
    if (external.username || external.password || external.port) return null

    const isBuiltinDocs =
      !external.search &&
      !external.hash &&
      ((external.hostname === 'docs.tavily.com' &&
        external.pathname === '/documentation/api-reference/endpoint/search') ||
        (external.hostname === 'developers.google.com' &&
          external.pathname === '/identity/protocols/oauth2/native-app') ||
        (external.hostname === 'developers.google.com' &&
          external.pathname === '/workspace/gmail/api/auth/scopes') ||
        (external.hostname === 'developers.google.com' &&
          external.pathname === '/workspace/tasks/auth') ||
        (external.hostname === 'developers.google.com' &&
          external.pathname === '/workspace/tasks/reference/rest/v1/tasklists/list') ||
        (external.hostname === 'console.cloud.google.com' &&
          external.pathname === '/auth/clients'))

    if (isBuiltinDocs) {
      return external.toString()
    }

    const normalized = external.toString()
    if (options.isAllowedDomain?.(external.hostname) || options.isSavedResearchUrl?.(normalized)) {
      return normalized
    }

    return null
  } catch {
    return null
  }
}
