import { z } from 'zod'
import type { CoachArea, ToolDef } from '../shared/types'
import type { CoachingStore } from '../core/coaching'

export function createCoachingTools(store: CoachingStore): ToolDef<any, any>[] {
  const context: ToolDef<{ area: CoachArea }, unknown> = {
    name: 'get_coaching_context',
    description: 'Read the user-approved coaching profile, active goals, and explicitly saved journal entries for one area. Choose personal or lb_english so private context stays in scope.',
    risk: 'read',
    input: z.object({ area: z.enum(['personal', 'lb_english']) }),
    scope: () => ({ kind: 'none' }),
    preview: (args) => `Read approved ${args.area === 'lb_english' ? 'Business / LB English' : 'Personal life'} coaching context.`,
    run: async (args) => store.context(args.area)
  }

  const goal: ToolDef<{ area: 'personal' | 'lb_english'; title: string; why?: string; targetDate?: string; milestones?: string[] }, unknown> = {
    name: 'create_coaching_goal',
    description: 'Create a Personal life or Business / LB English coaching goal after explicit approval.',
    risk: 'write',
    sessionApprovalAllowed: false,
    input: z.object({ area: z.enum(['personal', 'lb_english']), title: z.string().min(1).max(240), why: z.string().max(1000).optional(), targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), milestones: z.array(z.string().min(1).max(180)).max(12).optional() }),
    scope: () => ({ kind: 'none' }),
    preview: (args) => `Create ${args.area === 'lb_english' ? 'Business / LB English' : 'Personal life'} goal: ${args.title}`,
    run: async (args) => store.createGoal(args)
  }

  const journal: ToolDef<{ area: 'personal' | 'lb_english'; kind: 'daily' | 'weekly'; body: string }, unknown> = {
    name: 'save_coaching_journal',
    description: 'Save a daily check-in or weekly review to the private coaching journal after explicit approval.',
    risk: 'write',
    sessionApprovalAllowed: false,
    input: z.object({ area: z.enum(['personal', 'lb_english']), kind: z.enum(['daily', 'weekly']), body: z.string().min(1).max(12_000) }),
    scope: () => ({ kind: 'none' }),
    preview: (args) => `Save a ${args.kind} coaching reflection to the private journal (${args.body.length} chars).`,
    run: async (args) => store.addJournal(args)
  }

  const updateGoal: ToolDef<{ id: string; status?: 'active' | 'paused' | 'completed'; milestones?: Array<{ id: string; title: string; done: boolean }> }, unknown> = {
    name: 'update_coaching_goal',
    description: 'Update the status or milestones of an existing coaching goal after explicit approval.',
    risk: 'write',
    sessionApprovalAllowed: false,
    input: z.object({ id: z.string().uuid(), status: z.enum(['active', 'paused', 'completed']).optional(), milestones: z.array(z.object({ id: z.string().uuid(), title: z.string().min(1).max(180), done: z.boolean() })).max(12).optional() }),
    scope: () => ({ kind: 'none' }),
    preview: (args) => `Update coaching goal ${args.id}${args.status ? ` to ${args.status}` : ''}.`,
    run: async (args) => store.updateGoal(args.id, args)
  }

  return [context, goal, journal, updateGoal]
}
