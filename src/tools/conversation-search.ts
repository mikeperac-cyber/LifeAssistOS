import { z } from 'zod'
import type { ChatMode, ToolDef } from '../shared/types'
import type { ConversationStore } from '../core/conversations'

export function createConversationSearchTool(
  conversations: ConversationStore,
  currentMode: () => ChatMode
): ToolDef<{ query: string; limit: number }, unknown> {
  return {
    name: 'search_conversations',
    description:
      'Search a few relevant excerpts from Mike Assist chat history. Search stays local until approved; matching excerpts will be sent to the configured model. Coaching searches are restricted to the current coaching area, and ordinary chats cannot search coaching conversations.',
    risk: 'external',
    sessionApprovalAllowed: false,
    input: z.object({
      query: z.string().trim().min(2).max(500),
      limit: z.number().int().min(1).max(8).default(5)
    }),
    scope: () => ({ kind: 'none' }),
    preview: ({ query, limit }) => {
      const mode = currentMode()
      const area = mode === 'coach_personal'
        ? 'Personal coach conversations'
        : mode === 'coach_business'
          ? 'Business coach conversations'
          : 'non-coaching conversations'
      return `Search local ${area} for up to ${limit} excerpts. Matching text will be sent to the configured model only after approval. Query: ${query}`
    },
    run: async ({ query, limit }) => ({
      matches: conversations.searchMessages(query, currentMode(), limit)
    })
  }
}
