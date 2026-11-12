export type AssistantMode = 'coach' | 'teacher' | 'assistant'
export type AssistantLearningLevel = 'adaptive' | 'beginner' | 'intermediate' | 'advanced'

export interface AssistantChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AssistantChatRequest {
  requestId: string
  mode: AssistantMode
  messages: AssistantChatMessage[]
  includeTasks: boolean
  includeGoals?: boolean
  includeJournal?: boolean
  includePersonalContext?: boolean
  learningLevel?: AssistantLearningLevel
  localDate: string
  timeZone: string
}

export interface AssistantChatDelta {
  requestId: string
  text: string
}

export type AssistantChatResult =
  | { ok: true; reply: string }
  | { ok: false; error: string }
