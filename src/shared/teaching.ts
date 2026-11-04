export type TeachingSkill = 'writing' | 'speaking' | 'reading' | 'listening' | 'vocabulary' | 'teacher'

export interface TeachingPack {
  id: string
  title: string
  skill: TeachingSkill
  level: string
  description: string
  steps: string[]
  prompt: string
}

/** LB English starter packs: practical, reusable lesson frames for Mike's classes. */
export const TEACHING_PACKS: TeachingPack[] = [
  {
    id: 'ielts-writing-task-2',
    title: 'IELTS Writing Task 2 · band 6.5 sprint',
    skill: 'writing',
    level: 'Band 6–6.5',
    description: 'A 45-minute argument-building lesson with a clear thesis, paragraph logic, and targeted feedback.',
    steps: ['Diagnose the prompt and underline the task words', 'Build a two-position plan and a precise thesis', 'Draft one body paragraph with explanation and example', 'Give feedback using Task Response, Coherence, Lexical Resource, and Grammar'],
    prompt: 'Design a 45-minute IELTS Academic Writing Task 2 lesson for a Turkish learner targeting band 6.5. Include a realistic prompt, planning routine, thesis frame, one model body paragraph, and a short feedback checklist. Keep the language teachable and avoid promising a band score.'
  },
  {
    id: 'ielts-speaking-fluency',
    title: 'IELTS Speaking · fluency clinic',
    skill: 'speaking',
    level: 'Band 5.5–6.5',
    description: 'A low-pressure speaking cycle that turns short answers into developed, natural responses.',
    steps: ['Warm up with familiar Part 1 questions', 'Expand answers with answer–reason–example', 'Rehearse a Part 2 cue card with a one-minute plan', 'Repair one recurring Turkish L1 error without interrupting fluency'],
    prompt: 'Create an IELTS Academic Speaking fluency clinic for a Turkish learner at band 6. Include Part 1, Part 2, and Part 3 tasks, useful answer expansion language, a gentle correction routine, and a realistic self-study follow-up.'
  },
  {
    id: 'ielts-task-1-overview',
    title: 'IELTS Writing Task 1 · overview first',
    skill: 'writing',
    level: 'Band 6–7',
    description: 'A data-description lesson focused on selecting the main features before writing details.',
    steps: ['Group the visual into two or three meaningful features', 'Write an overview without numbers', 'Choose comparisons that answer the task', 'Edit grammar of comparison and approximation'],
    prompt: 'Build an IELTS Academic Writing Task 1 lesson around a line graph or bar chart. Teach overview-first planning, grouping, comparisons, approximation language, and a concise band-aware feedback rubric for a Turkish learner.'
  },
  {
    id: 'turkish-l1-error-clinic',
    title: 'Turkish L1 error clinic',
    skill: 'teacher',
    level: 'B1–C1',
    description: 'A reusable correction cycle for articles, word order, tense, and missing subjects without shaming learners.',
    steps: ['Collect three authentic learner sentences', 'Ask the learner to notice the mismatch first', 'Contrast the Turkish and English pattern briefly', 'Recycle the corrected form in a meaningful task'],
    prompt: 'Create a 30-minute English error clinic for Turkish-speaking learners. Use three authentic-looking examples, focus on one transferable pattern, include noticing questions, a short contrastive explanation, controlled practice, and a communicative recycle task.'
  },
  {
    id: 'weekly-ielts-sprint',
    title: 'Weekly IELTS study sprint',
    skill: 'teacher',
    level: 'Band 6.5 target',
    description: 'A realistic seven-day plan balancing timed practice, feedback, vocabulary recycling, and recovery.',
    steps: ['Choose one measurable skill target', 'Schedule two short deliberate-practice blocks', 'Complete one timed section and review errors', 'End the week with a reflection and next target'],
    prompt: 'Plan a realistic one-week IELTS Academic study sprint for a busy Turkish learner targeting band 6.5. Balance Writing, Speaking, Reading, and Listening without overload. Include daily time estimates, error-log prompts, and a small recovery day.'
  }
]
