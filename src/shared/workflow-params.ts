import type { WorkflowStep } from './types'

export const REPLAYABLE_WORKFLOW_TOOLS = [
  'list_dir',
  'read_file',
  'read_pdf',
  'read_office_document',
  'write_file',
  'search_notes',
  'create_note',
  'project_overview',
  'list_today',
  'capture_inbox',
  'create_task',
  'update_task',
  'complete_task',
  'list_vault',
  'read_vault_document',
  'save_vault_document',
  'finance_report',
  'record_transaction',
  'recall_memory',
  'remember_fact',
  'get_coaching_context',
  'create_coaching_goal',
  'save_coaching_journal'
] as const

export const META_DISCOVERY_TOOLS = new Set(['find_tools', 'load_skill'])

const PARAM_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

export function extractWorkflowParameters(steps: WorkflowStep[]): string[] {
  const seen = new Set<string>()
  const collectFromValue = (value: unknown): void => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(PARAM_PATTERN)) {
        const param = match[1]?.trim()
        if (param) seen.add(param)
      }
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) collectFromValue(item)
      return
    }
    if (value && typeof value === 'object') {
      for (const entry of Object.values(value as Record<string, unknown>)) {
        collectFromValue(entry)
      }
    }
  }

  for (const step of steps) {
    collectFromValue(step.args)
    collectFromValue(step.summary)
  }

  return [...seen]
}

export function interpolateWorkflowSteps(
  steps: WorkflowStep[],
  params: Record<string, string> = {},
  now: Date = new Date()
): WorkflowStep[] {
  const defaultDate = now.toISOString().slice(0, 10)
  const resolvedParams: Record<string, string> = {
    date: defaultDate,
    ...params
  }

  const replaceValue = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return value.replace(PARAM_PATTERN, (_full, key: string) => {
        const k = key.trim()
        return k in resolvedParams ? resolvedParams[k] : ''
      })
    }
    if (Array.isArray(value)) {
      return value.map(replaceValue)
    }
    if (value && typeof value === 'object') {
      const next: Record<string, unknown> = {}
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        next[key] = replaceValue(entry)
      }
      return next
    }
    return value
  }

  return steps.map((step) => ({
    tool: step.tool,
    args: replaceValue(step.args),
    summary: String(replaceValue(step.summary ?? step.tool))
  }))
}

export function buildWorkflowDraftFromTurn(
  prompt: string,
  calls: Array<{ name: string; args: unknown; summary?: string; ok: boolean }>
): { prompt: string; steps: WorkflowStep[] } | null {
  const trimmedPrompt = prompt.trim()
  if (!trimmedPrompt || calls.length === 0) return null
  if (calls.some((call) => !call.ok)) return null

  const replayableSet = new Set<string>(REPLAYABLE_WORKFLOW_TOOLS)
  const domainCalls = calls.filter((call) => !META_DISCOVERY_TOOLS.has(call.name))
  if (domainCalls.length === 0) return null
  if (domainCalls.some((call) => !replayableSet.has(call.name))) return null

  return {
    prompt: trimmedPrompt,
    steps: domainCalls.map((call) => ({
      tool: call.name,
      args: call.args,
      summary: call.summary ?? call.name
    }))
  }
}
