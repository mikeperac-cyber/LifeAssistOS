import type { EmailFollowupTaskInput } from './ipc'

export function isEmailFollowupTaskInput(value: unknown): value is EmailFollowupTaskInput {
  if (!value || typeof value !== 'object') return false
  const input = value as Partial<EmailFollowupTaskInput>
  if ((input.provider !== 'gmail' && input.provider !== 'outlook') || typeof input.messageId !== 'string' ||
      typeof input.title !== 'string' || input.title.trim().length < 1 || input.title.length > 240 || /[\u0000-\u001f\u007f]/.test(input.title)) return false
  if (input.provider === 'gmail') return /^[A-Za-z0-9_-]{1,256}$/.test(input.messageId)
  return /^[A-Za-z0-9_+/=-]{1,512}$/.test(input.messageId)
}
