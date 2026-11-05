import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
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

  it('creates an approval-gated prep task from a selected all-day calendar event only once', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-calendar-prep-tool-'))
    const vault = new VaultStore(path.join(dir, 'vault.sqlite'))
    const planning = new PlanningStore(path.join(dir, 'planning.sqlite'))
    await vault.init()
    await planning.init()
    const onTodayChanged = vi.fn()
    const tool = createCommandCenterTools(vault, planning, onTodayChanged).find((item) => item.name === 'create_calendar_prep_task')!
    const args = {
      provider: 'google_calendar' as const,
      eventId: 'google-event-123',
      eventTitle: 'Planning day',
      start: '2026-11-05',
      end: '2026-11-06',
      location: 'Room 4'
    }
    const context = { kind: 'none' as const, signal: new AbortController().signal }

    expect(tool.risk).toBe('write')
    expect(tool.sessionApprovalAllowed).toBe(false)
    expect(tool.preview!(args, context)).toContain('Event time: all day.')
    expect(tool.preview!(args, context)).toContain('The calendar is not changed.')
    expect(await tool.run(args, context)).toMatchObject({ status: 'created', title: 'Prepare for: Planning day', dueDate: '2026-11-05' })
    expect(await tool.run(args, context)).toMatchObject({ status: 'already_exists' })
    expect(planning.listTasks(true)).toHaveLength(1)
    expect(planning.listTasks(true)[0]).toMatchObject({
      calendarSource: { provider: 'google_calendar', eventId: 'google-event-123' },
      notes: expect.stringContaining('Location: Room 4')
    })
    expect(onTodayChanged).toHaveBeenCalledTimes(1)

    planning.close()
    vault.close()
    await rm(dir, { recursive: true, force: true })
  })
})
