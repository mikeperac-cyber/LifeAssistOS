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
    model: 'claude-sonnet-5',
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
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    needsKey: true,
    hint: 'One API key can route to models from many providers. Choose a model ID from the refreshed list below.'
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'openai/gpt-oss-20b',
    needsKey: true,
    hint: 'Fast hosted models through Groq’s OpenAI-compatible API. Model availability can vary by account.'
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    needsKey: true,
    hint: 'Use DeepSeek’s OpenAI-compatible Chat Completions API with a DeepSeek API key.'
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-small-latest',
    needsKey: true,
    hint: 'Use Mistral’s OpenAI-compatible Chat Completions API with a Mistral API key.'
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-4.7',
    needsKey: true,
    hint: 'Use xAI’s OpenAI-compatible API with an xAI API key.'
  },
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
