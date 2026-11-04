import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SkillStore } from '../src/core/skills'
import { defaultPolicy, resolveDecision } from '../src/core/gateway/policy'
import { createSkillTools } from '../src/tools/skills'

let directory = ''
let file = ''
let store: SkillStore

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'mike-assist-skills-'))
  file = path.join(directory, 'skills.json')
  store = new SkillStore(file)
  await store.init()
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('SkillStore', () => {
  it('saves and reloads skills while filtering coach scopes and disabled entries', async () => {
    const personal = await store.save({
      name: 'Personal check-in',
      description: 'Use for private weekly life reflections.',
      scope: 'personal',
      instructions: 'Ask one gentle question and end with a small next step.'
    })
    const general = await store.save({
      name: 'Clear writing',
      description: 'Use to make short writing easier to understand.',
      scope: 'general',
      instructions: 'Prefer specific verbs, short paragraphs, and concrete examples.'
    })
    const business = await store.save({
      name: 'Business review',
      description: 'Use for planning the English teaching business.',
      scope: 'business',
      instructions: 'Separate measured results from assumptions.'
    })
    await store.setEnabled(general.id, false)

    const reopened = new SkillStore(file)
    await reopened.init()

    expect(reopened.list()).toHaveLength(3)
    expect(reopened.enabledSummaries(['personal']).map((skill) => skill.id)).toEqual([personal.id])
    expect(reopened.enabledSummaries(['business']).map((skill) => skill.id)).toContain(business.id)
    expect(reopened.enabledSummaries(['business']).map((skill) => skill.id)).not.toContain(general.id)
    expect(JSON.parse(await readFile(file, 'utf8')).skills).toHaveLength(3)
  })

  it('updates in place and rejects duplicate names and oversized instructions', async () => {
    const skill = await store.save({
      name: 'Research outline',
      description: 'Use to create a source-backed research outline.',
      scope: 'research',
      instructions: 'State the question, compare sources, and mark uncertainty.'
    })
    const updated = await store.save({
      id: skill.id,
      name: 'Research outline',
      description: 'Use to create a source-backed research outline.',
      scope: 'research',
      instructions: 'Add a brief evidence table before the conclusion.'
    })

    expect(updated.id).toBe(skill.id)
    expect(updated.createdAt).toBe(skill.createdAt)
    expect(updated.instructions).toContain('evidence table')
    await expect(store.save({
      name: 'Research outline',
      description: 'Another description for a new task guide.',
      scope: 'general',
      instructions: 'This name already exists.'
    })).rejects.toThrow(/already exists/)
    await expect(store.save({
      name: 'Too much text',
      description: 'A task guide with too many instructions.',
      scope: 'general',
      instructions: 'x'.repeat(7_001)
    })).rejects.toThrow(/characters/)
  })

  it('loads only enabled skill text and refuses disabled skills', async () => {
    const skill = await store.save({
      name: 'Coding review',
      description: 'Use for reviewing a small code change.',
      scope: 'coding',
      instructions: 'Check correctness, security, and focused tests.'
    })
    const tool = createSkillTools(store)[0]
    const context = { kind: 'none' as const, signal: new AbortController().signal }

    await expect(tool.run({ id: skill.id }, context)).resolves.toMatchObject({
      id: skill.id,
      instructions: 'Check correctness, security, and focused tests.'
    })
    await store.setEnabled(skill.id, false)
    await expect(tool.run({ id: skill.id }, context)).rejects.toThrow(/unavailable or disabled/)
  })

  it('lets the assistant create or update skills through a one-time approval tool', async () => {
    const tool = createSkillTools(store).find((entry) => entry.name === 'save_skill')!
    const context = { kind: 'none' as const, signal: new AbortController().signal }
    const input = {
      name: 'Weekly business review',
      description: 'Use to turn a business reflection into one focused next step.',
      scope: 'business' as const,
      instructions: 'Separate observed results from assumptions. Choose one realistic action and ask one useful question.'
    }

    expect(tool.risk).toBe('write')
    expect(tool.sessionApprovalAllowed).toBe(false)
    expect(resolveDecision(tool.name, tool.risk, defaultPolicy).decision).toBe('ask')
    const preview = await tool.preview!(input, context)
    expect(preview).toContain(input.instructions)

    const created = await tool.run(input, context) as { id: string; name: string; enabled: boolean }
    expect(created).toMatchObject({ name: input.name, enabled: true })
    const updated = await tool.run({ ...input, id: created.id, instructions: 'Keep the review factual, then choose one action.' }, context) as { id: string; name: string }
    expect(updated).toMatchObject({ id: created.id, name: input.name })
    expect(store.getEnabled(created.id).instructions).toBe('Keep the review factual, then choose one action.')
  })
})
