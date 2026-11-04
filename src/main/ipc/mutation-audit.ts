import type { AuditLog } from '../../core/audit/log'

type MutationAuditEvent = Parameters<AuditLog['append']>[0]

export const SAVED_AUDIT_WARNING = 'The operation completed, but the activity log could not record it. Check the current view before retrying.'

/** Audit a user-authorized change after it commits without reporting the saved change as failed. */
export async function appendMutationAudit(
  audit: AuditLog | null,
  event: MutationAuditEvent,
  reportWarning: (message: string) => void
): Promise<boolean> {
  try {
    if (!audit) throw new Error('Audit log is not available.')
    await audit.append(event)
    return true
  } catch (error) {
    console.error('[audit] saved change could not be recorded', error)
    try { reportWarning(SAVED_AUDIT_WARNING) } catch { /* Keep the committed change successful. */ }
    return false
  }
}
