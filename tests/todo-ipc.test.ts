import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { IpcMain } from 'electron'
import { PlanningStore } from '../src/core/planning'
import { registerDomainIpcHandlers, type DomainIpcContext } from '../src/main/ipc/domain-handlers'

type Handler = (...args: any[]) => Promise<unknown> | unknown

const directories: string[] = []
const stores: PlanningStore[] = []

afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

describe('todo task IPC', () => {
  it('test_task_add_and_update_ipc_preserves_parent_task_id', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'mike-assist-todo-ipc-'))
    directories.push(directory)
    const planning = new PlanningStore(path.join(directory, 'planning.sqlite'))
    stores.push(planning)
    await planning.init()

    const handlers = new Map<string, Handler>()
    const ipcMain = {
      handle(channel: string, handler: Handler) { handlers.set(channel, handler); return ipcMain }
    } as unknown as IpcMain
    const context = {
      ipcMain,
      getPlanning: () => planning,
      errorMessage: (error: unknown) => error instanceof Error ? error.message : String(error)
    } as DomainIpcContext
    registerDomainIpcHandlers(context)

    const addTask = handlers.get('assist:plan-task-add')
    const updateTask = handlers.get('assist:plan-task-update')
    expect(addTask).toBeDefined()
    expect(updateTask).toBeDefined()

    const parentResult = await addTask?.({}, { title: 'Parent' }) as { ok: boolean; task?: { id: string } }
    expect(parentResult.ok).toBe(true)
    const childResult = await addTask?.({}, { title: 'Child', parentTaskId: parentResult.task?.id }) as { ok: boolean; task?: { id: string; parentTaskId: string | null } }
    expect(childResult.task?.parentTaskId).toBe(parentResult.task?.id)

    const updateResult = await updateTask?.({}, { id: childResult.task?.id, patch: { parentTaskId: null } }) as { ok: boolean; task?: { parentTaskId: string | null } }
    expect(updateResult).toMatchObject({ ok: true, task: { parentTaskId: null } })

    const inbox = planning.capture('Capture to edit')
    const remindAt = new Date(Date.now() + 60_000).toISOString()
    const convertInbox = handlers.get('assist:inbox-convert')
    const converted = await convertInbox?.({}, {
      id: inbox.id,
      input: { title: 'Edited capture', notes: 'Edited notes', dueDate: '2026-11-10', remindAt, priority: 'high' }
    }) as { ok: boolean; task?: { title: string; notes: string; dueDate: string | null; remindAt: string | null; priority: string } }
    expect(converted).toMatchObject({
      ok: true,
      task: { title: 'Edited capture', notes: 'Edited notes', dueDate: '2026-11-10', remindAt, priority: 'high' }
    })
  })
})
