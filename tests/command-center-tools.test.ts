import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PlanningStore } from '../src/core/planning'
import { VaultStore } from '../src/core/vault'
import { createCommandCenterTools } from '../src/tools/command-center'

describe('command-center assistant tools', () => {
  it('exposes read tools and approval-gated write tools with real stores', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-center-tools-'))
    const vault = new VaultStore(path.join(dir, 'vault.sqlite'))
    const planning = new PlanningStore(path.join(dir, 'planning.sqlite'))
    await vault.init()
    await planning.init()
    const tools = createCommandCenterTools(vault, planning)
    const byName = new Map(tools.map((tool) => [tool.name, tool]))

    expect(byName.get('search_vault')?.risk).toBe('read')
    expect(byName.get('list_today')?.risk).toBe('read')
    expect(byName.get('save_vault_document')?.risk).toBe('write')
    expect(byName.get('create_task')?.risk).toBe('write')
    expect(byName.get('create_email_followup_task')?.risk).toBe('write')
    expect(byName.get('update_task')?.risk).toBe('write')

    const task = await byName.get('create_task')!.run({ title: 'Review Task 2 thesis', priority: 'high' }, { kind: 'none', signal: new AbortController().signal })
    expect(task).toMatchObject({ title: 'Review Task 2 thesis', priority: 'high' })
    const today = await byName.get('list_today')!.run({}, { kind: 'none', signal: new AbortController().signal })
    expect(today).toMatchObject({ tasks: [{ title: 'Review Task 2 thesis' }] })

    const remindAt = new Date(Date.now() + 60_000).toISOString()
    const updatedTask = await byName.get('update_task')!.run(
      { id: (task as { id: string }).id, remindAt },
      { kind: 'none', signal: new AbortController().signal }
    )
    expect(updatedTask).toMatchObject({ remindAt })

    const createEmailTask = byName.get('create_email_followup_task')!
    const emailTaskArgs = {
      provider: 'outlook' as const,
      messageId: 'AQMkAGY3-selected-message',
      title: 'Send the revised lesson plan',
      notes: 'Include the Monday class changes.',
      dueDate: '2026-11-12',
      priority: 'high' as const
    }
    const emailTaskPreview = createEmailTask.preview!(emailTaskArgs, { kind: 'none', signal: new AbortController().signal })
    expect(emailTaskPreview).toContain('local Today task from Outlook email message ID AQMkAGY3-selected-message')
    expect(emailTaskPreview).toContain('Notes saved to this task:\nInclude the Monday class changes.')
    const emailTask = await createEmailTask.run(emailTaskArgs, { kind: 'none', signal: new AbortController().signal }) as { id: string }
    expect(planning.getTask(emailTask.id)).toMatchObject({
      title: emailTaskArgs.title,
      notes: emailTaskArgs.notes,
      dueDate: emailTaskArgs.dueDate,
      emailSource: { provider: 'outlook', messageId: emailTaskArgs.messageId }
    })
    expect(() => createEmailTask.input.parse({ ...emailTaskArgs, messageId: 'bad\nmessage-id' })).toThrow(/control characters/)

    const document = await byName.get('save_vault_document')!.run({ title: 'IELTS thesis', body: 'A thesis must answer the question.', tags: ['writing'] }, { kind: 'none', signal: new AbortController().signal })
    expect(document).toMatchObject({ title: 'IELTS thesis' })
    const results = await byName.get('search_vault')!.run({ query: 'thesis' }, { kind: 'none', signal: new AbortController().signal })
    expect(results).toHaveLength(1)

    vault.close()
    planning.close()
    await rm(dir, { recursive: true, force: true })
  })
})
