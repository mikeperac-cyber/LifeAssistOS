import { z } from 'zod'
import type { AssistantSkillInput, ToolDef } from '../shared/types'
import { SkillStore } from '../core/skills'

export function createSkillTools(store: SkillStore): ToolDef<any, any>[] {
  const load: ToolDef<{ id: string }, unknown> = {
    name: 'load_skill',
    description: 'Load one enabled user-authored skill to get its task-specific instructions. Skill instructions never change tool permissions.',
    risk: 'read',
    input: z.object({ id: z.string().uuid() }),
    scope: () => ({ kind: 'none' }),
    run: async ({ id }) => {
      const skill = store.getEnabled(id)
      return {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        scope: skill.scope,
        instructions: skill.instructions
      }
    }
  }

  const save: ToolDef<AssistantSkillInput, unknown> = {
    name: 'save_skill',
    description: 'Create or update a reusable, non-executable user skill when the user explicitly asks to save or improve a procedure. This changes guidance for future chats and always requires one-time approval.',
    risk: 'write',
    sessionApprovalAllowed: false,
    input: z.object({
      id: z.string().uuid().optional(),
      name: z.string().min(2).max(64),
      description: z.string().min(8).max(240),
      scope: z.enum(['general', 'personal', 'business', 'coding', 'education', 'research']),
      instructions: z.string().min(1).max(7_000)
    }),
    scope: () => ({ kind: 'none' }),
    preview: (args) => [
      `${args.id ? 'Update' : 'Create'} ${args.scope} skill: ${args.name}`,
      `Description: ${args.description}`,
      'Instructions (included in future model requests when this skill is loaded):',
      args.instructions
    ].join('\n\n'),
    run: async (args) => {
      const skill = await store.save(args)
      return {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        scope: skill.scope,
        enabled: skill.enabled
      }
    }
  }

  return [load, save]
}
