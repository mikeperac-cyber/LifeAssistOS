import type { ChatMessage, ToolCall, ToolResult } from '../../shared/types'

export type ToolCardState = {
  kind: 'tool'
  id: string
  call: ToolCall
  status: 'pending' | 'awaiting' | 'running' | 'success' | 'denied' | 'blocked' | 'failed'
  result?: ToolResult
}

export type TimelineItem = { kind: 'message'; message: ChatMessage } | ToolCardState

export function statusFor(result: ToolResult): ToolCardState['status'] {
  if (result.denied) return 'denied'
  if (result.blocked) return 'blocked'
  return result.ok ? 'success' : 'failed'
}
