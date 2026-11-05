import { describe, expect, it } from 'vitest'
import { isEmailFollowupTaskInput } from '../src/shared/email-followup-input'

describe('email follow-up task IPC input', () => {
  it('accepts provider-specific message IDs and a bounded task title', () => {
    expect(isEmailFollowupTaskInput({ provider: 'gmail', messageId: 'mail_123-abc', title: 'Follow up: Lesson plan' })).toBe(true)
    expect(isEmailFollowupTaskInput({ provider: 'outlook', messageId: 'AQMkAGY3+AB/==', title: 'Follow up: Lesson plan' })).toBe(true)
  })

  it('rejects malformed message IDs, blank titles, and control characters', () => {
    expect(isEmailFollowupTaskInput({ provider: 'gmail', messageId: 'bad/id', title: 'Follow up' })).toBe(false)
    expect(isEmailFollowupTaskInput({ provider: 'outlook', messageId: 'bad message', title: 'Follow up' })).toBe(false)
    expect(isEmailFollowupTaskInput({ provider: 'gmail', messageId: 'mail_123', title: '  ' })).toBe(false)
    expect(isEmailFollowupTaskInput({ provider: 'gmail', messageId: 'mail_123', title: 'Follow up\nDo something else' })).toBe(false)
    expect(isEmailFollowupTaskInput({ provider: 'unknown', messageId: 'mail_123', title: 'Follow up' })).toBe(false)
  })
})
