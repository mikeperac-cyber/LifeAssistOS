import type { PublicSettings } from '../../../shared/ipc'
import { providerRequiresApiKey } from '../../../shared/provider-endpoint'

/** Mirrors the providers accepted by the main process without exposing credentials to the renderer. */
export function isProviderReady(settings: PublicSettings | null): boolean {
  if (!settings) return false
  const { provider } = settings
  return !providerRequiresApiKey(provider.preset, provider.baseUrl) || provider.hasApiKey
}
