import { z } from 'zod'
import type { MemoryFact, MemoryRecall, ToolDef } from '../shared/types'
import type { MemoryStore } from '../core/memory'

const scopes = z.enum(['personal', 'teaching', 'business', 'general'])

const saveInput = z.object({
  text: z
    .string()
    .trim()
    .min(3)
    .max(400)
    .describe(
      'The fact to remember, as one short standalone sentence in the user\'s own words, e.g. "Mike teaches IELTS in Denizli".'
    ),
  scope: scopes.describe('Choose personal for Mike\'s private life, teaching for lessons and students, business for work, or general when it fits any area.'),
  reviewInDays: z
    .number()
    .int()
    .min(0)
    .max(3650)
    .optional()
    .describe('Optional: ask the user to review this fact again in N days. Omit or 0 for never.'),
  sourceRef: z
    .string()
    .max(120)
    .optional()
    .describe('Optional label of where this was discussed, e.g. a note title. Never paste file contents here.')
})

const recallInput = z.object({
  query: z.string().min(1).max(400).describe('Keywords to look up, e.g. "Denizli IELTS".'),
  limit: z.number().int().min(1).max(10).optional()
})

const archiveInput = z.object({
  id: z.string().min(1).describe('Id of the fact to archive, from save or recall results.')
})

export function createMemoryTools(store: MemoryStore): ToolDef<any, any>[] {
  type SaveInput = z.infer<typeof saveInput>
  const save: ToolDef<SaveInput, MemoryFact> = {
    name: 'save_memory',
    description:
      'Save one short durable fact about the user for later recall (up to 400 characters). Only save things the user clearly stated or explicitly asked you to remember. Saving always requires approval and is never batch-approved.',
    risk: 'write',
    sessionApprovalAllowed: false,
    input: saveInput,
    scope() {
      return { kind: 'none' }
    },
    preview(args) {
      return `Remember (${args.scope}): ${args.text}\n\nOnly the view in Memory is affected; nothing is sent anywhere.`
    },
    async run(args) {
      return store.add({
        text: args.text,
        scope: args.scope,
        reviewInDays: args.reviewInDays,
        source: { kind: 'user', ref: args.sourceRef }
      })
    }
  }

  const recall: ToolDef<{ query: string; limit?: number }, MemoryRecall> = {
    name: 'recall_memory',
    description:
      'Search approved personal memory for facts matching keywords. Use when the user asks what you remember, or when a stored fact would help answer correctly.',
    risk: 'read',
    input: recallInput,
    async run(args) {
      return {
        query: args.query,
        facts: store.recall(args.query, args.limit ?? 6)
      }
    }
  }

  const archive: ToolDef<{ id: string }, { archived: boolean }> = {
    name: 'archive_memory',
    description:
      'Move an approved memory fact out of active recall (the user can restore it in Memory). Only archive when the user asks, or when a recall shows a fact is plainly outdated.',
    risk: 'write',
    sessionApprovalAllowed: false,
    input: archiveInput,
    preview(args) {
      return `Archive memory fact ${args.id}. It stays recoverable from the Memory view.`
    },
    async run(args) {
      await store.archive(args.id)
      return { archived: true }
    }
  }

  return [save, recall, archive]
}
