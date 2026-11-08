import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { PlanningStore } from '../src/core/planning'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temporaryDirectories: string[] = []
const stores: PlanningStore[] = []

afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  for (const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true, force: true })
})

describe('retired assistant features', () => {
  it('test_retired_ipc_and_startup_imports_are_absent', async () => {
    const [ipcSource, mainSource, preloadSource, packageSource] = await Promise.all([
      readFile(path.join(root, 'src/shared/ipc.ts'), 'utf8'),
      readFile(path.join(root, 'src/main/index.ts'), 'utf8'),
      readFile(path.join(root, 'src/preload/index.ts'), 'utf8'),
      readFile(path.join(root, 'package.json'), 'utf8')
    ])
    const assistApiStart = ipcSource.indexOf('export interface AssistApi {')
    const assistApiEnd = ipcSource.indexOf('\n}', assistApiStart)
    const assistApi = ipcSource.slice(assistApiStart, assistApiEnd)

    for (const member of [
      'sendMessage(', 'getChatState(', 'getAudit(', 'getMemory(', 'getFinanceReport(',
      'getWorkflows(', 'getScheduledTasks(', 'getSkills(', 'getResearchProjects(',
      'getVaultDocuments(', 'getGoogleGmailSettings(', 'getMicrosoftTodoSettings(',
      'getCoachingContext(', 'getLocalApiStatus('
    ]) {
      expect(assistApi).not.toContain(member)
    }
    for (const retiredImport of [
      "from '../core/agent'", "from '../core/audit/log'", "from '../core/gateway/gateway'",
      "from '../core/memory'", "from '../core/finance'", "from '../core/research'",
      "from '../core/vault'", "from '../core/coaching'", "from '../core/mcp/manager'",
      "from '../core/scheduled-tasks'", "from '../core/skills'", "from './local-api-server'",
      "from '../tools/"
    ]) {
      expect(mainSource).not.toContain(retiredImport)
    }
    for (const channel of [
      'assist:send', 'assist:audit', 'assist:memory-list', 'assist:finance-report',
      'assist:research-projects', 'assist:vault-search', 'assist:workflow-run',
      'assist:scheduled-tasks', 'assist:mcp-servers', 'assist:google-gmail-settings'
    ]) {
      expect(preloadSource).not.toContain(channel)
    }
    const packageConfig = JSON.parse(packageSource) as {
      build: { appId: string; productName: string; nsis: { deleteAppDataOnUninstall: boolean } }
    }
    expect(packageConfig.build).toMatchObject({
      appId: 'com.mikeassist.desktop',
      productName: 'Mike Assist',
      nsis: { deleteAppDataOnUninstall: false }
    })
  })

  it('test_local_tasks_work_without_provider_credentials', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'mike-assist-local-tasks-'))
    temporaryDirectories.push(directory)
    const planning = new PlanningStore(path.join(directory, 'planning.sqlite'))
    stores.push(planning)
    await planning.init()

    const task = planning.addTask({ title: 'Work offline', notes: 'No provider configured.' })

    expect(task.title).toBe('Work offline')
    expect(planning.listTasks()).toContainEqual(expect.objectContaining({ id: task.id, title: task.title, status: 'open' }))
  })
})
