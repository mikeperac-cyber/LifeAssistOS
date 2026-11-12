import type { IpcMain } from 'electron'
import type { LifeGoalInput, JournalEntryInput, RoutineTemplateInput, CalendarEventInput, AssistEvent } from '../../shared/types'
import type { LifeStore } from '../../core/lifeos'

interface LifeIpcContext {
  ipcMain: Pick<IpcMain, 'handle'>
  getLife: () => LifeStore | null
  sendEvent: (event: AssistEvent) => void
  errorMessage: (error: unknown) => string
}

export function registerLifeIpcHandlers(context: LifeIpcContext): void {
  const { ipcMain } = context
  ipcMain.handle('assist:life-workspace', () => requiredLife(context).workspace())
  ipcMain.handle('assist:life-goal-save', (_event, raw: unknown) => {
    if (!isRecord(raw)) return failure('Enter a valid goal.')
    try { return { ok: true, goal: requiredLife(context).saveGoal(raw as unknown as LifeGoalInput) } }
    catch (error) { return failure(context.errorMessage(error)) }
  })
  ipcMain.handle('assist:life-goal-delete', (_event, id: unknown) => {
    if (!isId(id)) return failure('Choose a valid goal.')
    try { requiredLife(context).deleteGoal(id); return { ok: true } }
    catch (error) { return failure(context.errorMessage(error)) }
  })
  ipcMain.handle('assist:routines', () => requiredLife(context).listRoutines())
  ipcMain.handle('assist:routine-save', (_event, raw: unknown) => {
    if (!isRecord(raw)) return failure('Enter a valid routine.')
    try { return { ok: true, routine: requiredLife(context).saveRoutine(raw as unknown as RoutineTemplateInput) } }
    catch (error) { return failure(context.errorMessage(error)) }
  })
  ipcMain.handle('assist:routine-delete', (_event, id: unknown) => {
    if (!isId(id)) return failure('Choose a valid routine.')
    try { requiredLife(context).deleteRoutine(id); return { ok: true } }
    catch (error) { return failure(context.errorMessage(error)) }
  })
  ipcMain.handle('assist:routine-apply', (_event, raw: unknown) => {
    if (!isRecord(raw) || !isId(raw.id) || typeof raw.date !== 'string') return failure('Choose a valid routine and date.')
    try {
      const tasks = requiredLife(context).applyRoutine(raw.id, raw.date)
      context.sendEvent({ type: 'today_changed' })
      return { ok: true, tasks }
    } catch (error) { return failure(context.errorMessage(error)) }
  })
  ipcMain.handle('assist:journal-list', (_event, query: unknown) => requiredLife(context).listJournal(typeof query === 'string' ? query : ''))
  ipcMain.handle('assist:journal-pinned-list', () => requiredLife(context).listPinnedJournal())
  ipcMain.handle('assist:journal-save', (_event, raw: unknown) => {
    if (!isRecord(raw)) return failure('Enter a valid note.')
    try { return { ok: true, journalEntry: requiredLife(context).saveJournal(raw as unknown as JournalEntryInput) } }
    catch (error) { return failure(context.errorMessage(error)) }
  })
  ipcMain.handle('assist:journal-pin', (_event, raw: unknown) => {
    if (!isRecord(raw) || !isId(raw.id) || typeof raw.isPinned !== 'boolean') return failure('Choose a valid note and pin state.')
    try { return { ok: true, journalEntry: requiredLife(context).setJournalPinned(raw.id, raw.isPinned) } }
    catch (error) { return failure(context.errorMessage(error)) }
  })
  ipcMain.handle('assist:journal-delete', (_event, id: unknown) => {
    if (!isId(id)) return failure('Choose a valid note.')
    try { requiredLife(context).deleteJournal(id); return { ok: true } }
    catch (error) { return failure(context.errorMessage(error)) }
  })
  ipcMain.handle('assist:personal-context', () => requiredLife(context).getPersonalContext())
  ipcMain.handle('assist:personal-context-save', (_event, raw: unknown) => {
    if (!isRecord(raw)) throw new Error('Enter a valid personal context.')
    try { return requiredLife(context).savePersonalContext(raw as { aboutMe: string; preferences: string; currentFocus: string }) }
    catch (error) { throw new Error(context.errorMessage(error)) }
  })
  ipcMain.handle('assist:calendar-sources', () => requiredLife(context).listCalendarSources())
  ipcMain.handle('assist:calendar-events', (_event, raw: unknown) => {
    if (!isRecord(raw) || typeof raw.start !== 'string' || typeof raw.end !== 'string') return []
    try { return requiredLife(context).listCalendarEvents(raw.start, raw.end) } catch { return [] }
  })
  ipcMain.handle('assist:calendar-import', (_event, raw: unknown) => {
    if (!isRecord(raw) || !(raw.id === null || isId(raw.id)) || typeof raw.name !== 'string' || !Array.isArray(raw.events) || raw.events.length > 5000) return failure('Choose a valid calendar file.')
    if (raw.events.some((event) => !isRecord(event))) return failure('This calendar contains an invalid event.')
    try { return { ok: true, source: requiredLife(context).replaceCalendarSource(raw.id as string | null, raw.name, raw.events as unknown as CalendarEventInput[]) } }
    catch (error) { return failure(context.errorMessage(error)) }
  })
  ipcMain.handle('assist:calendar-delete', (_event, id: unknown) => {
    if (!isId(id)) return failure('Choose a valid calendar.')
    try { requiredLife(context).deleteCalendarSource(id); return { ok: true } }
    catch (error) { return failure(context.errorMessage(error)) }
  })
}

function requiredLife(context: LifeIpcContext): LifeStore {
  const life = context.getLife()
  if (!life) throw new Error('LifeAssistOS is still starting. Try again in a moment.')
  return life
}

function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function isId(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 80 }
function failure(error: string): { ok: false; error: string } { return { ok: false, error } }
