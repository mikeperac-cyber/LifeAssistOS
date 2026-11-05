import type { ProviderSettings } from '../../shared/types'
import { createAnthropicProvider } from './anthropic'
import { createOpenAICompatibleProvider } from './openai-compatible'
import type { Provider } from './types'

export type ProviderModelRole = 'default' | 'fast' | 'vision'

export interface ProviderFactoryOptions {
  fetchImpl?: typeof fetch
}

export function resolveModelForRole(
  settings: ProviderSettings,
  role: ProviderModelRole = 'default'
): string {
  if (role === 'fast' && settings.fastModel?.trim()) {
    return settings.fastModel.trim()
  }
  if (role === 'vision' && settings.visionModel?.trim()) {
    return settings.visionModel.trim()
  }
  return settings.model.trim()
}

export function createProviderForSettings(
  settings: ProviderSettings,
  role: ProviderModelRole = 'default',
  options?: ProviderFactoryOptions
): Provider {
  const model = resolveModelForRole(settings, role)

  if (settings.preset === 'anthropic') {
    return createAnthropicProvider({
      baseUrl: settings.baseUrl,
      model,
      apiKey: settings.apiKey,
      temperature: settings.temperature,
      fetchImpl: options?.fetchImpl
    })
  }

  return createOpenAICompatibleProvider({
    baseUrl: settings.baseUrl,
    model,
    apiKey: settings.apiKey,
    temperature: settings.temperature,
    imageUrlFormat: settings.preset === 'ollama' ? 'string' : 'nested',
    maxTokensField: settings.preset === 'cerebras' ? 'max_completion_tokens' : 'max_tokens',
    fetchImpl: options?.fetchImpl
  })
}
