import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryStore, normalizeScope, normalizeText } from '../src/core/memory'

let root = ''
let store: MemoryStore

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mike-assist-memory-'))
  store = new MemoryStore(path.join(root, 'memory.sqlite'))
  await store.init()
})

afterEach(async () => {
  store.close()
  await rm(root, { recursive: true, force: true })
})

describe('normalize', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeText('  Mike   teaches\n IELTS  ')).toBe('Mike teaches IELTS')
  })

  it('accepts only known scopes', () => {
    expect(normalizeScope('teaching')).toBe('teaching')
    expect(() => normalizeScope('world')).toThrow(/scope/)
  })
})

describe('MemoryStore', () => {
  it('adds a fact with defaults and a stable source', () => {
    const fact = store.add({ text: '  Mike teaches  IELTS ', scope: 'teaching' })
    expect(fact.text).toBe('Mike teaches IELTS')
    expect(fact.scope).toBe('teaching')
    expect(fact.source.kind).toBe('user')
    expect(fact.archivedAt).toBeNull()
    expect(fact.reviewAt).toBeNull()
  })

  it('schedules review when asked', () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    const fact = store.add({ text: 'Follow up with Anna', scope: 'business', reviewInDays: 30 }, now)
    expect(fact.reviewAt).toBe('2026-01-31T00:00:00.000Z')
  })

  it('rejects empty, oversized, and duplicate facts', () => {
    store.add({ text: 'Mike teaches IELTS', scope: 'teaching' })
    expect(() => store.add({ text: 'Hi', scope: 'personal' })).toThrow(/words|characters/i)
    expect(() => store.add({ text: `x${'y'.repeat(400)}`, scope: 'personal' })).toThrow(/at most/)
    expect(() => store.add({ text: 'Mike teaches IELTS', scope: 'personal' })).toThrow(/already saved/)
  })

  it('updates text and scope with dedupe against other facts', () => {
    const first = store.add({ text: 'Mike teaches IELTS', scope: 'teaching' })
    const second = store.add({ text: 'Mike lives in Denizli', scope: 'personal' })

    const updated = store.update(second.id, { text: 'mike lives near izmir', scope: 'business' })
    expect(updated.text).toBe('mike lives near izmir')
    expect(updated.scope).toBe('business')
    expect(updated.updatedAt >= first.createdAt).toBe(true)

    expect(() => store.update(second.id, { text: 'Mike teaches IELTS' })).toThrow(/already saved/)
  })

  it('archives, restores, and hard-deletes', () => {
    const fact = store.add({ text: 'Mike drinks too much coffee', scope: 'general' })

    const archived = store.archive(fact.id)
    expect(archived.archivedAt).toBeTruthy()
    expect(store.list()).toHaveLength(0)
    expect(store.list(true)).toHaveLength(1)
    expect(store.recall('coffee')).toHaveLength(0)

    const restored = store.restore(fact.id)
    expect(restored.archivedAt).toBeNull()
    expect(store.list()).toHaveLength(1)

    store.delete(fact.id)
    expect(store.list()).toHaveLength(0)
    expect(() => store.get(fact.id)).toThrow(/no longer exists/)
  })

  it('recall scores keyword matches and is case-insensitive', () => {
    store.add({ text: 'Mike teaches IELTS in Denizli', scope: 'teaching' })
    store.add({ text: 'The最喜欢的 lesson is speaking', scope: 'teaching' })
    store.add({ text: 'Grocery budget is 300 a week', scope: 'personal' })

    const hits = store.recall('DENIZLI ielts')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.text).toBe('Mike teaches IELTS in Denizli')

    const none = store.recall('quantum physics')
    expect(none).toHaveLength(0)
    const empty = store.recall('')
    expect(empty).toHaveLength(0)
  })

  it('remembers which source was attached', () => {
    store.add({ text: 'Project Apollo starts in March', scope: 'business', source: { kind: 'note', ref: 'roadmap.md' } })
    const [hit] = store.recall('apollo')
    expect(hit).toBeTruthy()
    expect(store.get(hit!.id).source).toEqual({ kind: 'note', ref: 'roadmap.md' })
  })
})
