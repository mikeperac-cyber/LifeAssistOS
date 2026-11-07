import { describe, expect, it } from 'vitest'
import { canSubmitComposer, type ComposerSubmissionState } from '../src/renderer/src/components/chat-composer'

const ready: ComposerSubmissionState = {
  providerSetupRequired: false,
  busy: false,
  preparingAttachments: false,
  input: '',
  pendingImageCount: 0
}

describe('chat composer submission', () => {
  it('allows text or an image only when chat is ready', () => {
    expect(canSubmitComposer({ ...ready, input: '  ', pendingImageCount: 0 })).toBe(false)
    expect(canSubmitComposer({ ...ready, input: 'Summarize this', pendingImageCount: 0 })).toBe(true)
    expect(canSubmitComposer({ ...ready, input: '', pendingImageCount: 1 })).toBe(true)
    expect(canSubmitComposer({ ...ready, busy: true, input: 'Hello', pendingImageCount: 0 })).toBe(false)
    expect(canSubmitComposer({ ...ready, providerSetupRequired: true, input: 'Hello', pendingImageCount: 0 })).toBe(false)
    expect(canSubmitComposer({ ...ready, preparingAttachments: true, pendingImageCount: 1 })).toBe(false)
  })
})
