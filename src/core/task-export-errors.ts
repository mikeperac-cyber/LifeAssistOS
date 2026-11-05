export class TaskExportError extends Error {
  constructor(message: string, readonly outcomeUnknown = false) {
    super(message)
    this.name = 'TaskExportError'
  }
}
