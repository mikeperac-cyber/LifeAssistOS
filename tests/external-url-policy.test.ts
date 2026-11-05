import { describe, expect, it } from 'vitest'
import { resolveExternalPopupUrl } from '../src/core/external-links'

describe('resolveExternalPopupUrl', () => {
  it('allows built-in documentation URLs without query or credentials', () => {
    expect(
      resolveExternalPopupUrl('https://docs.tavily.com/documentation/api-reference/endpoint/search')
    ).toBe('https://docs.tavily.com/documentation/api-reference/endpoint/search')

    expect(
      resolveExternalPopupUrl('https://console.cloud.google.com/auth/clients')
    ).toBe('https://console.cloud.google.com/auth/clients')

    expect(
      resolveExternalPopupUrl('https://developers.google.com/workspace/tasks/auth')
    ).toBe('https://developers.google.com/workspace/tasks/auth')

    expect(
      resolveExternalPopupUrl('https://developers.google.com/workspace/tasks/reference/rest/v1/tasklists/list')
    ).toBe('https://developers.google.com/workspace/tasks/reference/rest/v1/tasklists/list')
  })

  it('allows HTTPS URLs on user-allowlisted domains or saved research sources', () => {
    expect(
      resolveExternalPopupUrl('https://en.wikipedia.org/wiki/Denizli?lang=en#history', {
        isAllowedDomain: (host) => host === 'en.wikipedia.org'
      })
    ).toBe('https://en.wikipedia.org/wiki/Denizli?lang=en#history')

    expect(
      resolveExternalPopupUrl('https://arxiv.org/abs/2401.00001', {
        isSavedResearchUrl: (url) => url === 'https://arxiv.org/abs/2401.00001'
      })
    ).toBe('https://arxiv.org/abs/2401.00001')
  })

  it('blocks non-HTTPS URLs, URLs with credentials/ports, and unapproved domains', () => {
    expect(
      resolveExternalPopupUrl('http://en.wikipedia.org/wiki/Denizli', {
        isAllowedDomain: () => true
      })
    ).toBeNull()

    expect(
      resolveExternalPopupUrl('https://user:pass@en.wikipedia.org/wiki/Denizli', {
        isAllowedDomain: () => true
      })
    ).toBeNull()

    expect(
      resolveExternalPopupUrl('https://en.wikipedia.org:8443/wiki/Denizli', {
        isAllowedDomain: () => true
      })
    ).toBeNull()

    expect(
      resolveExternalPopupUrl('https://untrusted.example.com/page', {
        isAllowedDomain: () => false,
        isSavedResearchUrl: () => false
      })
    ).toBeNull()
  })
})
