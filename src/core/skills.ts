import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AssistantSkill, AssistantSkillInput, AssistantSkillScope, AssistantSkillSummary } from '../shared/types'

interface SkillFile {
  version: 1
  skills: AssistantSkill[]
}

const SCOPES = new Set<AssistantSkillScope>(['general', 'personal', 'business', 'coding', 'education', 'research'])
export const MAX_ASSISTANT_SKILLS = 24
export const MAX_SKILL_INSTRUCTIONS = 7_000

/** User-authored, non-executable guidance that the assistant can load by request. */
export class SkillStore {
  private skills: AssistantSkill[] = []

  constructor(private readonly file: string) {}

  async init(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true })
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as Partial<SkillFile>
      this.skills = Array.isArray(parsed.skills)
        ? parsed.skills.filter(isSkill).slice(0, MAX_ASSISTANT_SKILLS).map(cloneSkill)
        : []
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[skills] could not read skill library; starting empty', error)
      }
      this.skills = []
    }
    await this.persist()
  }

  list(): AssistantSkill[] {
    return [...this.skills]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(cloneSkill)
  }

  enabledSummaries(scopes?: AssistantSkillScope[]): AssistantSkillSummary[] {
    const allowed = scopes ? new Set(scopes) : null
    return this.list()
      .filter((skill) => skill.enabled && (!allowed || allowed.has(skill.scope) || skill.scope === 'general'))
      .map(({ id, name, description, scope }) => ({ id, name, description, scope }))
  }

  getEnabled(id: string): AssistantSkill {
    const skill = this.skills.find((entry) => entry.id === id && entry.enabled)
    if (!skill) throw new Error('That skill is unavailable or disabled.')
    return cloneSkill(skill)
  }

  async save(input: AssistantSkillInput): Promise<AssistantSkill> {
    const name = input.name.replace(/\s+/g, ' ').trim()
    const description = input.description.replace(/\s+/g, ' ').trim()
    const instructions = input.instructions.trim()
    if (name.length < 2 || name.length > 64) throw new Error('Skill names must be 2–64 characters.')
    if (description.length < 8 || description.length > 240) throw new Error('Skill descriptions must be 8–240 characters.')
    if (!SCOPES.has(input.scope)) throw new Error('Choose a valid skill category.')
    if (!instructions || instructions.length > MAX_SKILL_INSTRUCTIONS) {
      throw new Error(`Skill instructions must contain 1–${MAX_SKILL_INSTRUCTIONS} characters.`)
    }

    const existingIndex = input.id ? this.skills.findIndex((entry) => entry.id === input.id) : -1
    if (input.id && existingIndex < 0) throw new Error('That skill no longer exists.')
    if (!input.id && this.skills.length >= MAX_ASSISTANT_SKILLS) {
      throw new Error(`The skill library is full. Remove a skill before adding another (maximum ${MAX_ASSISTANT_SKILLS}).`)
    }
    if (this.skills.some((entry, index) => index !== existingIndex && entry.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      throw new Error('A skill with that name already exists.')
    }

    const now = new Date().toISOString()
    const existing = existingIndex >= 0 ? this.skills[existingIndex] : undefined
    const skill: AssistantSkill = {
      id: existing?.id ?? randomUUID(),
      name,
      description,
      scope: input.scope,
      instructions,
      enabled: input.enabled ?? existing?.enabled ?? true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }
    if (existingIndex >= 0) this.skills[existingIndex] = skill
    else this.skills.push(skill)
    await this.persist()
    return cloneSkill(skill)
  }

  async setEnabled(id: string, enabled: boolean): Promise<AssistantSkill> {
    const index = this.skills.findIndex((entry) => entry.id === id)
    if (index < 0) throw new Error('That skill no longer exists.')
    this.skills[index] = { ...this.skills[index], enabled, updatedAt: new Date().toISOString() }
    await this.persist()
    return cloneSkill(this.skills[index])
  }

  async remove(id: string): Promise<AssistantSkill> {
    const index = this.skills.findIndex((entry) => entry.id === id)
    if (index < 0) throw new Error('That skill no longer exists.')
    const [removed] = this.skills.splice(index, 1)
    await this.persist()
    return cloneSkill(removed)
  }

  private async persist(): Promise<void> {
    const payload: SkillFile = { version: 1, skills: this.skills }
    const temporary = `${this.file}.tmp`
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    await rename(temporary, this.file)
  }
}

function isSkill(value: unknown): value is AssistantSkill {
  if (!value || typeof value !== 'object') return false
  const skill = value as Partial<AssistantSkill>
  return typeof skill.id === 'string' && skill.id.length <= 64 &&
    typeof skill.name === 'string' && skill.name.length >= 2 && skill.name.length <= 64 &&
    typeof skill.description === 'string' && skill.description.length >= 8 && skill.description.length <= 240 &&
    typeof skill.scope === 'string' && SCOPES.has(skill.scope as AssistantSkillScope) &&
    typeof skill.instructions === 'string' && skill.instructions.trim().length > 0 && skill.instructions.length <= MAX_SKILL_INSTRUCTIONS &&
    typeof skill.enabled === 'boolean' && typeof skill.createdAt === 'string' && typeof skill.updatedAt === 'string'
}

function cloneSkill(skill: AssistantSkill): AssistantSkill {
  return { ...skill }
}
