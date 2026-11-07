export interface ComposerSubmissionState {
  providerSetupRequired: boolean
  busy: boolean
  preparingAttachments: boolean
  input: string
  pendingImageCount: number
}

export function canSubmitComposer(state: ComposerSubmissionState): boolean {
  return !state.providerSetupRequired && !state.busy && !state.preparingAttachments &&
    (state.input.trim().length > 0 || state.pendingImageCount > 0)
}
