import type { z } from 'zod'
import type { FinanceCategory } from './finance'

/**
 * How dangerous a tool is, independent of which tool it is.
 *
 * - read        local, no egress, no mutation
 * - write       local mutation, reversible
 * - command     runs an approved local command in a writable grant
 * - external    leaves the machine (fetch, send, post)
 * - destructive irreversible local change
 * - privileged  changes system security posture or elevated privileges
 */
export type Risk = 'read' | 'write' | 'command' | 'external' | 'destructive' | 'privileged'

/** What the policy engine decides for a proposed call. */
export type Decision = 'allow' | 'ask' | 'block'

export interface ToolCall {
  id: string
  name: string
  args: unknown
  summary?: string
  /** Display hint; the gateway always uses the registered tool's risk. */
  risk?: Risk
  /** The call may incorporate content returned by an external source. */
  tainted?: boolean
}

export interface ToolResult {
  callId: string
  ok: boolean
  output?: unknown
  error?: string
  denied?: boolean
  blocked?: boolean
  /** A timeout or cancellation left the side-effect outcome unconfirmed. */
  outcomeUnknown?: boolean
  durationMs?: number
}

/** A folder the user has explicitly approved the assistant to touch. */
export interface FolderGrant {
  id: string
  label: string
  /** Canonical (realpath'd) absolute path. */
  root: string
  access: 'read' | 'read-write'
  createdAt: string
  /** The assistant-owned workspace; cannot be removed. */
  builtIn?: boolean
}

/** Minimal read surface the tools need; `GrantStore` implements it. */
export interface GrantLookup {
  list(): FolderGrant[]
  primary(): FolderGrant
  get(idOrLabel?: string): FolderGrant
}

export interface PathScope {
  kind: 'path'
  grantId: string
  grantLabel: string
  /** Canonical absolute path, already jail-checked by the tool. */
  path: string
  /** Path relative to the grant root, for display. */
  relative: string
}

export interface UrlScope {
  kind: 'url'
  host: string
  url: string
}

export interface NoScope {
  kind: 'none'
}

export type ToolScope = PathScope | UrlScope | NoScope

export interface ScopeContext {
  grants: GrantLookup
  primaryGrantId: string
}

/** Context handed to `run` and `preview` after the gateway validated the scope. */
export type ToolContext =
  | {
      kind: 'path'
      signal: AbortSignal
      /** Available only to tools explicitly given a per-run tool-call bridge. */
      callTool?: (name: string, args: unknown) => Promise<ToolResult>
      /** Canonical path the gateway validated. Tools must not re-resolve it. */
      path: string
      grant: FolderGrant
      relative: string
    }
  | { kind: 'none'; signal: AbortSignal; callTool?: (name: string, args: unknown) => Promise<ToolResult> }

export interface ToolRuntime {
  /** Optional nested tool bridge, scoped and checked by the active Agent turn. */
  callTool?: (name: string, args: unknown) => Promise<ToolResult>
}

export interface ToolDef<A = unknown, R = unknown> {
  name: string
  description: string
  risk: Risk
  /** True when an aborted call may still have changed remote state. */
  mayHaveSideEffectsOnFailure?: boolean
  /** Optional per-tool execution limit, in milliseconds. */
  timeoutMs?: number
  input: z.ZodType<A>
  /** Canonical scope the gateway re-checks before execution. */
  scope?: (args: A, ctx: ScopeContext) => ToolScope | Promise<ToolScope>
  /** Human-readable summary shown in the approval dialog. Must not have side effects. */
  preview?: (args: A, ctx: ToolContext) => string | Promise<string>
  run: (args: A, ctx: ToolContext) => Promise<R>
  /**
   * Non-idempotent or dangerous tools must set this to `false` so an approval
   * can never be silently reused for a later call in the same chat.
   */
  sessionApprovalAllowed?: boolean
  /** Set on close-to-irreversible actions to require a typed confirmation. */
  verb?: PermissionVerb
}

export interface PermissionRequest {
  id: string
  callId: string
  tool: string
  risk: Risk
  summary: string
  preview?: string
  scope?: string
  /** Absolute path, when the call is path-scoped. */
  path?: string
  grantLabel?: string
  tainted?: boolean
  sessionApprovalAllowed?: boolean
  /** Present when the action requires a typed confirmation token. */
  confirm?: PermissionConfirm
  /** Identifies an API-originated action in the approval dialog. */
  source?: 'local_api'
}

export type ApprovalChoice = 'deny' | 'once' | 'session'

export type AuditType =
  | 'chat.message'
  | 'conversation.created'
  | 'conversation.switched'
  | 'conversation.renamed'
  | 'conversation.deleted'
  | 'conversation.message_deleted'
  | 'call.proposed'
  | 'policy.decided'
  | 'approval.requested'
  | 'approval.granted'
  | 'approval.denied'
  | 'approval.expired'
  | 'call.started'
  | 'call.completed'
  | 'call.failed'
  | 'call.cancelled'
  | 'call.blocked'
  | 'approval.cancelled'
  | 'approval.session_granted'
  | 'agent.step'
  | 'agent.nudged'
  | 'agent.stopped'
  | 'grant.added'
  | 'grant.removed'
  | 'grant.access_changed'
  | 'settings.changed'
  | 'local_api.requested'
  | 'local_api.enabled'
  | 'local_api.disabled'
  | 'web_search.settings_changed'
  | 'google_calendar.settings_changed'
  | 'google_calendar.connected'
  | 'google_calendar.disconnected'
  | 'google_gmail.settings_changed'
  | 'google_gmail.connected'
  | 'google_gmail.disconnected'
  | 'google_drive.settings_changed'
  | 'google_drive.connected'
  | 'google_drive.disconnected'
  | 'google_tasks.settings_changed'
  | 'google_tasks.connected'
  | 'google_tasks.disconnected'
    | 'microsoft_todo.settings_changed'
    | 'microsoft_todo.connected'
    | 'microsoft_todo.disconnected'
  | 'microsoft_calendar.settings_changed'
  | 'microsoft_calendar.connected'
  | 'microsoft_calendar.disconnected'
  | 'microsoft_mail.settings_changed'
  | 'microsoft_mail.connected'
  | 'microsoft_mail.disconnected'
  | 'domain.added'
  | 'domain.removed'
  | 'backup.created'
  | 'backup.restored'
  | 'speech.endpoint_changed'
  | 'onboarding.completed'
  | 'finance.imported'
  | 'workflow.saved'
  | 'workflow.removed'
  | 'workflow.started'
  | 'workflow.completed'
  | 'scheduled_task.created'
  | 'scheduled_task.updated'
  | 'scheduled_task.removed'
  | 'scheduled_task.started'
  | 'scheduled_task.completed'
  | 'skill.changed'
  | 'memory.updated'
  | 'memory.archived'
  | 'memory.deleted'
  | 'memory.recalled'
  | 'mcp.server_added'
  | 'mcp.server_removed'
  | 'mcp.connected'
  | 'mcp.disconnected'
  | 'mcp.failed'
  | 'mcp.tools_changed'
  | 'research.project_created'
  | 'research.project_archived'
  | 'research.project_removed'
  | 'research.source_added'
  | 'research.source_removed'
  | 'vault.document_created'
  | 'vault.document_updated'
  | 'vault.document_deleted'
  | 'plan.task_created'
  | 'plan.task_updated'
  | 'plan.task_completed'
  | 'plan.reminder_notified'
  | 'plan.inbox_captured'
  | 'plan.inbox_converted'
  | 'plan.inbox_dismissed'
  | 'coaching.profile_updated'
  | 'coaching.goal_created'
  | 'coaching.goal_updated'
  | 'coaching.goal_completed'
  | 'coaching.journal_saved'

export interface AuditEvent {
  id: string
  at: string
  sessionId: string
  callId?: string
  type: AuditType
  data: Record<string, unknown>
  /** Present on M2 records; earlier legacy entries remain readable. */
  prevHash?: string
  hash?: string
}

export interface GoogleTaskList {
  id: string
  title: string
  updated?: string
}

export interface GoogleTask {
  id: string
  title: string
  notes?: string
  notesTruncated?: boolean
  due?: string
  status: 'needsAction' | 'completed'
  updated?: string
}

export interface MicrosoftTodoTaskList {
  id: string
  title: string
  updated?: string
}

export interface MicrosoftTodoTask {
  id: string
  title: string
  notes?: string
  notesTruncated?: boolean
  due?: string
  status: 'notStarted' | 'inProgress' | 'completed' | 'waitingOnOthers' | 'deferred'
  updated?: string
}

export interface MicrosoftCalendarEvent {
  id: string
  title: string
  start: string
  end: string
  isAllDay: boolean
  location?: string
  showAs?: 'free' | 'tentative' | 'busy' | 'oof' | 'workingElsewhere' | 'unknown'
}

export interface GoogleCalendarEvent {
  id: string
  summary: string
  startsAt: string
  endsAt: string
  isAllDay: boolean
  description?: string
  location?: string
  link?: string
}

export interface MicrosoftMailMessageSummary {
  id: string
  subject: string
  from?: string
  receivedAt?: string
  isRead?: boolean
  hasAttachments?: boolean
}

export interface MicrosoftMailMessage extends MicrosoftMailMessageSummary {
  body: string
  bodyTruncated?: boolean
  note: string
}

export interface GoogleGmailMessageSummary {
  id: string
  from: string
  to: string
  subject: string
  date: string
  snippet: string
}

export interface AuditIntegrity {
  valid: boolean
  legacyEvents: number
  chainedEvents: number
  brokenEventId?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  at: string
  /** The mode active for this message, used to keep recalled sessions scoped. */
  mode?: ChatMode
  /** Metadata for local image attachments. Image bytes stay in the local conversation database. */
  attachments?: ChatImageAttachment[]
}

export const CHAT_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export const MAX_CHAT_IMAGE_ATTACHMENTS = 4
export const MAX_CHAT_IMAGE_BYTES = 8 * 1024 * 1024
export const MAX_CHAT_IMAGE_TOTAL_BYTES = 16 * 1024 * 1024

export interface ChatImageAttachment {
  id: string
  name: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  size: number
}

/** Base64 is used only across the renderer/main IPC boundary. */
export interface ChatImageAttachmentInput {
  name: string
  mimeType: string
  data: string
}

export type ChatMode =
  | 'assistant'
  | 'brainstorm'
  | 'software'
  | 'review'
  | 'coach_personal'
  | 'coach_business'

export interface ChatSession {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export type FinanceDirection = 'income' | 'expense'

/** Amount is entered as a decimal string to avoid floating-point rounding. */
export interface FinanceTransactionInput {
  direction: FinanceDirection
  amount: string
  currency: string
  category: FinanceCategory
  merchant?: string
  note?: string
  occurredAt?: string
}

export interface FinanceTransaction {
  id: string
  direction: FinanceDirection
  amountMinor: number
  currency: string
  fractionDigits: number
  category: FinanceCategory
  merchant: string
  note: string
  occurredAt: string
  createdAt: string
}

export interface FinanceCurrencyTotals {
  currency: string
  fractionDigits: number
  incomeMinor: number
  expenseMinor: number
  netMinor: number
  transactionCount: number
}

export interface FinanceCategoryTotal {
  direction: FinanceDirection
  category: FinanceCategory
  currency: string
  fractionDigits: number
  amountMinor: number
  transactionCount: number
}

export interface FinanceReport {
  period: 'week' | 'month'
  startsAt: string
  endsAt: string
  totals: FinanceCurrencyTotals[]
  byCategory: FinanceCategoryTotal[]
  recent: FinanceTransaction[]
}

export interface WorkflowStep {
  tool: string
  args: unknown
  summary: string
}

export interface WorkflowRecord {
  id: string
  name: string
  prompt: string
  steps: WorkflowStep[]
  createdAt: string
}

export type ScheduledTaskSchedule =
  | { kind: 'once'; at: string }
  | { kind: 'daily'; time: string }
  | { kind: 'weekdays'; time: string }
  | { kind: 'weekly'; weekday: number; time: string }

/** A user-authored prompt that runs on this device while Mike Assist is open. */
export interface ScheduledAgentTask {
  id: string
  name: string
  prompt: string
  mode: ChatMode
  schedule: ScheduledTaskSchedule
  enabled: boolean
  nextRunAt: string | null
  lastRunAt: string | null
  lastOutcome: 'success' | 'failed' | null
  lastSummary: string | null
  lastError: string | null
  runCount: number
  createdAt: string
  updatedAt: string
}

export interface ScheduledAgentRun {
  id: string
  taskId: string
  trigger: 'scheduled' | 'manual'
  status: 'success' | 'failed'
  summary: string
  error: string | null
  startedAt: string
  finishedAt: string
}

export type AssistantSkillScope = 'general' | 'personal' | 'business' | 'coding' | 'education' | 'research'

export interface AssistantSkill {
  id: string
  name: string
  description: string
  scope: AssistantSkillScope
  instructions: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type AssistantSkillInput = Pick<AssistantSkill, 'name' | 'description' | 'scope' | 'instructions'> & {
  id?: string
  enabled?: boolean
}

export type AssistantSkillSummary = Pick<AssistantSkill, 'id' | 'name' | 'description' | 'scope'>

/* ---------- Personal memory ---------- */

/** Facts live in scopes so recall and review can be targeted. */
export type MemoryScope = 'personal' | 'teaching' | 'business' | 'general'

/** Where an approved fact came from. Only the kind is ever logged. */
export type MemorySourceKind = 'user' | 'chat' | 'agent' | 'file' | 'note' | 'web' | 'mcp'

export interface MemorySource {
  kind: MemorySourceKind
  /** Optional opaque locator, such as a conversation id or file path label. */
  ref?: string
}

export interface MemoryFactInput {
  text: string
  scope: MemoryScope
  /** Optional review reminder in days; 0 means never. */
  reviewInDays?: number
  source?: MemorySource
}

export interface MemoryFact {
  id: string
  text: string
  scope: MemoryScope
  source: MemorySource
  createdAt: string
  updatedAt: string
  reviewAt: string | null
  archivedAt: string | null
}

export interface MemoryFactPatch {
  text?: string
  scope?: MemoryScope
  reviewInDays?: number
}

export interface MemoryMatch {
  id: string
  text: string
  scope: MemoryScope
  updatedAt: string
}

export interface MemoryRecall {
  query: string
  facts: MemoryMatch[]
}

/* ---------- MCP connections ---------- */

export type McpTransport = 'stdio' | 'http'

/** A connector the user configured by hand; Mike Assist never installs anything. */
export interface McpServerRecord {
  id: string
  /** Short name used to build invocation names, 1-24 chars. */
  name: string
  transport: McpTransport
  /** Executable path for stdio transport; must exist when used (no auto-install). */
  command?: string
  args?: string[]
  /** URL for http transport: https anywhere, plain http only for loopback. */
  url?: string
  enabled: boolean
  createdAt: string
}

export interface McpServerInput {
  name: string
  transport: McpTransport
  command?: string
  args?: string[]
  url?: string
  enabled: boolean
}

export type McpStatus = 'disabled' | 'connecting' | 'connected' | 'error' | 'removed'

/** One discoverable MCP tool, with both the invocation and original name. */
export interface McpToolInfo {
  /** Registry name, e.g. mcp__demo__read_text. */
  invocationName: string
  /** Original server-side tool name. */
  toolName: string
  description: string
}

export interface McpServerInfo {
  id: string
  name: string
  transport: McpTransport
  detail: string
  enabled: boolean
  status: McpStatus
  error?: string
  tools: McpToolInfo[]
  /** True when the server exposes more tools than v1 registers. */
  truncated: boolean
}

/* ---------- Research desk ---------- */

export type ResearchProjectStatus = 'active' | 'archived'

export interface ResearchSource {
  id: string
  projectId: string
  url: string
  title: string
  content: string
  contentChars: number
  addedAt: string
}

export interface ResearchProject {
  id: string
  title: string
  question: string
  status: ResearchProjectStatus
  createdAt: string
  updatedAt: string
  sources: ResearchSource[]
}

/* ---------- Knowledge vault ---------- */

export type VaultSourceType = 'note' | 'research' | 'teaching' | 'manual'

export interface VaultDocument {
  id: string
  title: string
  body: string
  tags: string[]
  sourceType: VaultSourceType
  sourceRef?: string
  createdAt: string
  updatedAt: string
}

export interface VaultSearchResult {
  document: VaultDocument
  snippet: string
}

/* ---------- Plans / Today / inbox ---------- */

export type PlanTaskStatus = 'open' | 'done' | 'cancelled'
export type PlanTaskPriority = 'low' | 'normal' | 'high'
export type TaskExportProvider = 'google_tasks' | 'microsoft_todo'
export type TaskExportStatus = 'sending' | 'sent' | 'failed' | 'uncertain'

export interface TaskExportRecord {
  provider: TaskExportProvider
  taskListId: string
  status: TaskExportStatus
  remoteTaskId?: string
  updatedAt: string
}

export type EmailTaskProvider = 'gmail' | 'outlook'

export interface EmailTaskSource {
  provider: EmailTaskProvider
  messageId: string
}

export type CalendarTaskProvider = 'google_calendar' | 'microsoft_calendar'

export interface CalendarTaskSource {
  provider: CalendarTaskProvider
  eventId: string
}

export interface PlanTask {
  id: string
  title: string
  notes: string
  dueDate: string | null
  /** Optional local reminder instant stored as canonical UTC ISO-8601. */
  remindAt: string | null
  priority: PlanTaskPriority
  status: PlanTaskStatus
  createdAt: string
  updatedAt: string
  completedAt: string | null
  sourceInboxId?: string
  sourceGoalId?: string
  emailSource?: EmailTaskSource
  calendarSource?: CalendarTaskSource
  taskExports?: TaskExportRecord[]
}

export interface InboxItem {
  id: string
  text: string
  createdAt: string
  convertedTaskId: string | null
  dismissedAt: string | null
}

export interface TodaySnapshot {
  date: string
  tasks: PlanTask[]
  inbox: InboxItem[]
}

/* ---------- Smart life coaching ---------- */

export type CoachArea = 'personal' | 'lb_english'
export type CoachingStyle = 'supportive' | 'direct' | 'socratic'
export type ReflectionRetention = 'ephemeral' | 'journal'
export type CoachingJournalKind = 'daily' | 'weekly'
export type CoachingGoalStatus = 'active' | 'paused' | 'completed'

export interface CoachingProfile {
  style: CoachingStyle
  reflectionRetention: ReflectionRetention
  boundaries: string
  updatedAt: string
}

export interface CoachingMilestone {
  id: string
  title: string
  done: boolean
}

export interface CoachingGoal {
  id: string
  area: CoachArea
  title: string
  why: string
  targetDate: string | null
  status: CoachingGoalStatus
  milestones: CoachingMilestone[]
  createdAt: string
  updatedAt: string
}

export interface CoachingJournalEntry {
  id: string
  area: CoachArea
  kind: CoachingJournalKind
  body: string
  createdAt: string
}

export interface CoachingContext {
  profile: CoachingProfile
  goals: CoachingGoal[]
  journal: CoachingJournalEntry[]
}

/* ---------- Approval cards ---------- */

/**
 * Close-to-irreversible verbs that require a typed confirmation before the
 * gateway will accept an approval. No session approval is offered for these.
 */
export type PermissionVerb = 'send' | 'delete' | 'post' | 'buy' | 'run'

export interface PermissionConfirm {
  verb: PermissionVerb
  /** Shown above the confirmation input. */
  prompt: string
  /** The exact token the user must type, e.g. "DELETE". */
  expects: string
}

export type AssistEvent =
  | { type: 'user_message'; message: ChatMessage }
  | { type: 'assistant_delta'; id: string; text: string }
  | { type: 'assistant_message'; message: ChatMessage }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'tool_result'; result: ToolResult }
  | { type: 'permission_request'; request: PermissionRequest }
  | { type: 'permission_resolved'; requestId: string; approved: boolean; expired?: boolean }
  | { type: 'audit'; event: AuditEvent }
  | { type: 'warning'; message: string }
  | { type: 'error'; message: string }
  | { type: 'busy'; busy: boolean }
  | { type: 'step'; index: number; max: number }
  | { type: 'local_api_activity'; active: boolean; summary?: string }
  | { type: 'today_changed' }
  | { type: 'scheduled_tasks_changed' }

/** Provider connection settings, persisted outside the audit log. */
export interface ProviderSettings {
  preset: 'ollama' | 'lmstudio' | 'openai' | 'anthropic' | 'gemini' | 'custom'
  baseUrl: string
  model: string
  /** Optional faster/smaller model used for isolated helper delegations. */
  fastModel?: string
  /** Optional multimodal model used when a turn includes image attachments. */
  visionModel?: string
  /** Keep Mike Assist running in the system tray when the window is closed. */
  keepInBackground?: boolean
  /** Only present in memory after the user enters it; persisted encrypted. */
  apiKey?: string
  contextLength: number
  temperature: number
  maxSteps: number
}

export interface AppSettings {
  provider: ProviderSettings
}

export interface ProviderStatus {
  ok: boolean
  message: string
  models?: string[]
}
