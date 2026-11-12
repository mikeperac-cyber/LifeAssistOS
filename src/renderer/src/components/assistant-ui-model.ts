import type { AssistantMode } from '../../../shared/assistant'

export type CapturedReplyKeys = Record<AssistantMode, string>

export const EMPTY_CAPTURED_REPLY_KEYS: CapturedReplyKeys = {
  coach: '',
  teacher: '',
  assistant: ''
}

export function isReplyCaptured(state: CapturedReplyKeys, mode: AssistantMode, replyKey: string): boolean {
  return replyKey.length > 0 && state[mode] === replyKey
}

export function markReplyCaptured(state: CapturedReplyKeys, mode: AssistantMode, replyKey: string): CapturedReplyKeys {
  return { ...state, [mode]: replyKey }
}

export function clearCapturedReply(state: CapturedReplyKeys, mode: AssistantMode): CapturedReplyKeys {
  return { ...state, [mode]: '' }
}
