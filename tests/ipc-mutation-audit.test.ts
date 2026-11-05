import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { IpcMain } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuditLog } from '../src/core/audit/log'
import { PlanningStore } from '../src/core/planning'
import { ResearchStore } from '../src/core/research'
import { appendMutationAudit, SAVED_AUDIT_WARNING } from '../src/main/ipc/mutation-audit'
import { registerDomainIpcHandlers } from '../src/main/ipc/domain-handlers'

let directory = ''

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
  directory = ''
})

describe('IPC mutation audit failures', () => {
  it('keeps a committed user mutation successful when its audit append fails', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'mike-assist-ipc-audit-'))
    const research = new ResearchStore(path.join(directory, 'research.sqlite'))
    await research.init()

    const auditDirectory = path.join(directory, 'audit')
    await mkdir(auditDirectory)
    await writeFile(path.join(auditDirectory, '2026-11.jsonl'), '{bad json}\n', 'utf8')
    const audit = new AuditLog(auditDirectory, 'ipc-test')
    await audit.init()
    const warnings: string[] = []
    const handlers = new Map<string, Function>()
    const ipcMain = {
      handle: (channel: string, handler: Function) => handlers.set(channel, handler)
    } as unknown as IpcMain
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    registerDomainIpcHandlers({
      ipcMain,
      getGateway: () => null,
      getResearch: () => research,
      getVault: () => null,
      getPlanning: () => null,
      getCoaching: () => null,
      getWorkflows: () => null,
      getScheduledTasks: () => null,
      getScheduledTaskScheduler: () => null,
      getSkills: () => null,
      appendAuditAfterMutation: (event) => appendMutationAudit(audit, event, (message) => warnings.push(message)),
      hasRunningAssistantTask: () => false,
      setDirectToolBusy: () => undefined,
      errorMessage: (error) => error instanceof Error ? error.message : String(error)
    })

    try {
      const createProject = handlers.get('assist:research-project-create')
      expect(createProject).toBeDefined()
      const result = await createProject!({}, { title: 'Saved research', question: 'Did the operation commit?' }) as {
        ok: boolean
        project?: { id: string }
        error?: string
      }

      expect(result.ok).toBe(true)
      expect(result.error).toBeUndefined()
      expect(result.project?.id).toBeTruthy()
      expect(research.list()).toHaveLength(1)
      expect(warnings).toEqual([SAVED_AUDIT_WARNING])
    } finally {
      errorSpy.mockRestore()
      research.close()
    }
  })

  it('copies open provider tasks locally and refuses to reopen completed provider tasks', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'mike-assist-task-import-ipc-'))
    const planning = new PlanningStore(path.join(directory, 'planning.sqlite'))
    await planning.init()
    const handlers = new Map<string, Function>()
    const ipcMain = {
      handle: (channel: string, handler: Function) => handlers.set(channel, handler)
    } as unknown as IpcMain
    const auditEvents: string[] = []

    registerDomainIpcHandlers({
      ipcMain,
      getGateway: () => null,
      getResearch: () => null,
      getVault: () => null,
      getPlanning: () => planning,
      getCoaching: () => null,
      getWorkflows: () => null,
      getScheduledTasks: () => null,
      getScheduledTaskScheduler: () => null,
      getSkills: () => null,
      appendAuditAfterMutation: async (event) => { auditEvents.push(event.type); return true },
      hasRunningAssistantTask: () => false,
      setDirectToolBusy: () => undefined,
      errorMessage: (error) => error instanceof Error ? error.message : String(error)
    })

    try {
      const importTask = handlers.get('assist:plan-task-import')
      expect(importTask).toBeDefined()
      const completed = await importTask!({}, {
        provider: 'google_tasks', taskListId: 'work', taskId: 'done-1', title: 'Already finished', status: 'completed'
      }) as { ok: boolean; error?: string }
      expect(completed.ok).toBe(false)
      expect(completed.error).toMatch(/completed provider tasks/i)
      expect(planning.listTasks()).toHaveLength(0)

      const copied = await importTask!({}, {
        provider: 'microsoft_todo', taskListId: 'work', taskId: 'open-1', title: 'Prepare lesson',
        notes: 'Bring the worksheet', dueDate: '2026-11-10', priority: 'high', status: 'inProgress'
      }) as { ok: boolean; created?: boolean; task?: { title: string; priority: string; remoteTaskSource?: { provider: string; taskListId: string; taskId: string } } }
      expect(copied).toMatchObject({
        ok: true,
        created: true,
        task: {
          title: 'Prepare lesson', priority: 'high',
          remoteTaskSource: { provider: 'microsoft_todo', taskListId: 'work', taskId: 'open-1' }
        }
      })
      expect(auditEvents).toEqual(['plan.task_imported'])
      expect(planning.listTasks()).toHaveLength(1)
    } finally {
      planning.close()
    }
  })
})
