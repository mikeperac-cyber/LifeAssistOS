import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CoachingStore } from '../src/core/coaching'
import { createCoachingTools } from '../src/tools/coaching'

describe('CoachingStore', () => {
  it('keeps recent journal context available independently for both coaching areas', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-coaching-context-'))
    const store = new CoachingStore(path.join(dir, 'coaching.sqlite'))
    await store.init()
    const personal = store.addJournal({ area: 'personal', kind: 'weekly', body: 'Protect time to recover after busy work weeks.' })

    // Ensure every business entry is newer than the personal reflection so a
    // global six-entry limit would hide it from Personal coach mode.
    await new Promise((resolve) => setTimeout(resolve, 10))
    for (let index = 0; index < 7; index += 1) {
      store.addJournal({ area: 'lb_english', kind: 'daily', body: `Business check-in ${index + 1}.` })
    }

    expect(store.context('personal').journal.map((entry) => entry.id)).toContain(personal.id)
    expect(store.context('lb_english').journal).toHaveLength(6)
    expect(store.context().journal.filter((entry) => entry.area === 'personal').map((entry) => entry.id)).toContain(personal.id)

    store.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('keeps Personal and LB English goals separate and defaults reflections to ephemeral', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-coaching-'))
    const store = new CoachingStore(path.join(dir, 'coaching.sqlite'))
    await store.init()
    expect(store.profile().reflectionRetention).toBe('ephemeral')
    const personal = store.createGoal({ area: 'personal', title: 'Protect a weekly recovery block', why: 'Keep energy sustainable.' })
    const teaching = store.createGoal({ area: 'lb_english', title: 'Build a reusable Task 2 lesson', targetDate: '2027-01-15' })
    expect(store.listGoals('personal').map((goal) => goal.id)).toEqual([personal.id])
    expect(store.listGoals('lb_english').map((goal) => goal.id)).toEqual([teaching.id])
    expect(store.context().journal).toHaveLength(0)
    const journal = store.addJournal({ area: 'personal', kind: 'daily', body: 'I protected the recovery block.' })
    expect(store.context().journal[0]?.id).toBe(journal.id)
    expect(store.context('lb_english').goals.map((goal) => goal.id)).toEqual([teaching.id])
    expect(store.context('lb_english').journal).toHaveLength(0)
    expect(store.context('personal').journal.map((entry) => entry.id)).toEqual([journal.id])
    expect(store.updateGoal(personal.id, { status: 'paused' }).status).toBe('paused')
    expect(() => store.createGoal({ area: 'personal', title: 'Invalid target', targetDate: '2026-02-31' })).toThrow(/real calendar target date/)
    expect(store.updateGoal(teaching.id, { status: 'completed' }).status).toBe('completed')
    expect(store.listGoals('lb_english')).toHaveLength(0)
    store.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('exposes read context and non-session-approvable writes as tools', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-coaching-tools-'))
    const store = new CoachingStore(path.join(dir, 'coaching.sqlite'))
    await store.init()
    const tools = new Map(createCoachingTools(store).map((tool) => [tool.name, tool]))
    expect(tools.get('get_coaching_context')?.risk).toBe('read')
    expect(tools.get('create_coaching_goal')?.sessionApprovalAllowed).toBe(false)
    expect(tools.get('save_coaching_journal')?.sessionApprovalAllowed).toBe(false)
    const goal = await tools.get('create_coaching_goal')!.run({ area: 'lb_english', title: 'Review learner error logs', milestones: ['Choose one recurring pattern'] }, { kind: 'none', signal: new AbortController().signal })
    expect(goal).toMatchObject({ area: 'lb_english', title: 'Review learner error logs' })
    const context = await tools.get('get_coaching_context')!.run({ area: 'personal' }, { kind: 'none', signal: new AbortController().signal })
    expect(context).toMatchObject({ goals: [], journal: [] })
    expect(tools.get('update_coaching_goal')?.sessionApprovalAllowed).toBe(false)
    const updated = await tools.get('update_coaching_goal')!.run({ id: (goal as { id: string }).id, status: 'completed' }, { kind: 'none', signal: new AbortController().signal })
    expect(updated).toMatchObject({ status: 'completed' })
    store.close()
    await rm(dir, { recursive: true, force: true })
  })
})
