import type { Decision, Risk } from '../../shared/types'

export interface PolicyConfig {
  /** Per-tool decisions. Unknown tools fall back to `defaultDecision`. */
  tools: Record<string, Decision>
  defaultDecision: Decision
  approvalTimeoutMs: number
  /** Risks that can never be allowed by tool policy, only blocked. */
  hardBlockedRisks: Risk[]
}

/** Risks that change state on disk. */
export const MUTATING_RISKS: Risk[] = ['write', 'command', 'external', 'destructive', 'privileged']

export const HARD_BLOCKED_RISKS: Risk[] = ['destructive', 'privileged']

export const defaultPolicy: PolicyConfig = {
  tools: {
    list_dir: 'allow',
    read_file: 'allow',
    read_pdf: 'allow',
    read_office_document: 'allow',
    project_overview: 'allow',
    search_notes: 'allow',
    write_file: 'ask',
    list_file_checkpoints: 'allow',
    restore_file_checkpoint: 'ask',
    run_command: 'ask',
    execute_code: 'ask',
    create_note: 'ask',
    create_email_draft: 'ask',
    create_calendar_event: 'ask',
    record_transaction: 'ask',
    finance_report: 'allow',
    save_memory: 'ask',
    recall_memory: 'allow',
    archive_memory: 'ask',
    load_skill: 'allow',
    save_skill: 'ask',
    web_fetch: 'allow',
    web_search: 'ask',
    browser_open_url: 'ask',
    browser_inspect: 'ask',
    browser_click: 'ask',
    browser_fill: 'ask',
    google_calendar_list_events: 'ask',
    google_calendar_create_event: 'ask',
    google_calendar_update_event: 'ask',
    gmail_search_messages: 'ask',
    gmail_read_message: 'ask',
    gmail_create_draft: 'ask',
    gmail_send_message: 'ask',
    google_drive_search_files: 'ask',
    google_drive_read_file: 'ask',
    google_tasks_list_task_lists: 'ask',
    google_tasks_list_tasks: 'ask',
    google_tasks_create_from_today_task: 'ask',
    microsoft_todo_list_task_lists: 'ask',
    microsoft_todo_list_tasks: 'ask',
    microsoft_todo_create_from_today_task: 'ask',
    microsoft_calendar_list_events: 'ask',
    microsoft_mail_search_messages: 'ask',
    microsoft_mail_read_message: 'ask',
    search_vault: 'allow',
    list_today: 'allow',
    save_vault_document: 'ask',
    capture_inbox: 'ask',
    create_task: 'ask',
    create_email_followup_task: 'ask',
    clear_task_export_retry_guard: 'ask',
    update_task: 'ask',
    complete_task: 'ask',
    get_coaching_context: 'allow',
    create_coaching_goal: 'ask',
    save_coaching_journal: 'ask',
    update_coaching_goal: 'ask',
    schedule_agent_task: 'ask',
    list_scheduled_agent_tasks: 'allow',
    delegate_task: 'ask',
    delegate_tasks: 'ask',
    search_conversations: 'ask',
    find_tools: 'allow'
  },
  defaultDecision: 'block',
  approvalTimeoutMs: 60_000,
  hardBlockedRisks: HARD_BLOCKED_RISKS
}

export function isMutating(risk: Risk): boolean {
  return MUTATING_RISKS.includes(risk)
}

export interface DecisionResult {
  decision: Decision
  reason: string
}

export function resolveDecision(toolName: string, risk: Risk, policy: PolicyConfig): DecisionResult {
  if (policy.hardBlockedRisks.includes(risk)) {
    return {
      decision: 'block',
      reason: `risk "${risk}" is hard-blocked and cannot be overridden`
    }
  }

  const configured = policy.tools[toolName]
  if (configured) {
    return { decision: configured, reason: `tool policy for "${toolName}" is "${configured}"` }
  }

  // MCP tools are only reachable through the manager, which registers them
  // explicitly, so any mcp__ tool that reaches this point has no user policy.
  // Server annotations are untrusted: every MCP call asks, every time.
  if (toolName.startsWith('mcp__')) {
    return { decision: 'ask', reason: 'MCP tools are untrusted and always ask' }
  }

  return {
    decision: policy.defaultDecision,
    reason: `no policy for "${toolName}"; default is "${policy.defaultDecision}"`
  }
}
