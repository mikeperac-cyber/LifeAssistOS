import type { ProviderSettings } from './types'

export interface ProviderPreset {
  id: ProviderSettings['preset']
  label: string
  baseUrl: string
  model: string
  needsKey: boolean
  hint: string
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'ollama',
    label: 'Ollama (local)',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5:3b',
    needsKey: false,
    hint: 'Start Ollama first. For longer conversations set OLLAMA_CONTEXT_LENGTH before starting the server.'
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (local)',
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: 'qwen2.5-7b-instruct',
    needsKey: false,
    hint: 'In LM Studio, start the local server and load a tool-capable model.'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    needsKey: true,
    hint: 'Requests leave this computer. The provider receives your messages and any context included in each request; the whole disk is never uploaded.'
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-3-5-sonnet-latest',
    needsKey: true,
    hint: 'Requests leave this computer and use Anthropic’s Messages API. Enter an Anthropic API key below.'
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    needsKey: true,
    hint: 'Requests leave this computer and use Google’s OpenAI-compatible Gemini endpoint. Enter a Gemini API key below.'
  },
  {
    id: 'custom',
    label: 'Other OpenAI-compatible',
    baseUrl: 'http://127.0.0.1:8080/v1',
    model: '',
    needsKey: false,
    hint: 'Use a loopback URL for a local server. Remote providers receive chat content and should use HTTPS.'
  }
]

export function presetFor(id: ProviderSettings['preset']): ProviderPreset {
  return PROVIDER_PRESETS.find((preset) => preset.id === id) ?? PROVIDER_PRESETS[0]
}
