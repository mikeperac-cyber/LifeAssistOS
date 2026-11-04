import type { AssistApi } from '../../shared/ipc'

declare global {
  interface Window {
    assist: AssistApi
  }
}

export {}
