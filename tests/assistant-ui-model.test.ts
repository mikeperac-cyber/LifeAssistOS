import { describe, expect, it } from 'vitest'
import { clearCapturedReply, EMPTY_CAPTURED_REPLY_KEYS, isReplyCaptured, markReplyCaptured } from '../src/renderer/src/components/assistant-ui-model'

describe('assistant reply capture state', () => {
  it('tracks captured replies independently for each mode', () => {
    const coachKey = 'coach:2:next step'
    const teacherKey = 'teacher:2:practice'
    const coachState = markReplyCaptured(EMPTY_CAPTURED_REPLY_KEYS, 'coach', coachKey)
    const bothState = markReplyCaptured(coachState, 'teacher', teacherKey)

    expect(isReplyCaptured(bothState, 'coach', coachKey)).toBe(true)
    expect(isReplyCaptured(bothState, 'teacher', teacherKey)).toBe(true)
    expect(isReplyCaptured(bothState, 'assistant', 'assistant:2:checklist')).toBe(false)
  })

  it('clears only the selected mode when its conversation is cleared', () => {
    const state = markReplyCaptured(markReplyCaptured(EMPTY_CAPTURED_REPLY_KEYS, 'coach', 'coach:2:reply'), 'teacher', 'teacher:2:reply')
    const next = clearCapturedReply(state, 'coach')

    expect(isReplyCaptured(next, 'coach', 'coach:2:reply')).toBe(false)
    expect(isReplyCaptured(next, 'teacher', 'teacher:2:reply')).toBe(true)
  })
})
