import type { WorkflowStep } from '../../shared/types'

/** Build a user-visible request that turns a successful local workflow into reusable guidance. */
export function buildSkillLearningRequest(steps: Pick<WorkflowStep, 'tool'>[]): string {
  const tools = [...new Set(steps.map((step) => step.tool))]
  return [
    'Create an enabled reusable skill from the completed task immediately above in this conversation.',
    tools.length > 0 ? `The successful workflow used these tools: ${tools.join(', ')}.` : '',
    'Use the task goal and high-level process to write guidance that will help with future similar tasks.',
    'Generalize one-off paths, file contents, names, dates, amounts, personal details, and exact arguments. Never include credentials, tokens, or secrets.',
    'Include when to use the skill and a concise repeatable process with useful checks.',
    'Choose the best scope from general, personal, business, coding, education, or research; ask me first if it is unclear.',
    'Do not replay the task. Propose it with save_skill so I can inspect the complete skill in the approval preview; save it only after I approve.'
  ].filter(Boolean).join(' ')
}
