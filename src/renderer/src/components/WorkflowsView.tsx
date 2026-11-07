import { useEffect, useState } from 'react'
import type { ChatMode, WorkflowRecord } from '../../../shared/types'
import type { WorkflowRunResult } from '../../../shared/ipc'
import { extractWorkflowParameters } from '../../../shared/workflow-params'

interface WorkflowsViewProps {
  workflows: WorkflowRecord[]
  runningId: string | null
  disabled: boolean
  searchTargetId?: string | null
  onSearchTargetConsumed?: () => void
  onRun: (id: string, params?: Record<string, string>) => Promise<WorkflowRunResult>
  onRemove: (id: string) => Promise<{ ok: boolean; error?: string }>
  onLaunchPrompt: (prompt: string, mode: ChatMode) => boolean
}

const GUIDED_WORKFLOWS: Array<{
  title: string
  mode: ChatMode
  description: string
  path: string
  prompt: string
}> = [
  {
    title: 'Lesson design studio',
    mode: 'plan',
    description: 'Build a paced lesson with clear objectives, active practice, and a quick check for learning.',
    path: 'Plan · Teach · Check',
    prompt: 'Help me design a teacher-ready lesson. First ask only for details needed to avoid guessing: learner age and level, subject or topic, lesson length, class size, and any constraints. Then create a timed plan with measurable objectives, a short model or input, active practice, differentiation, formative checks, an exit ticket, and a materials list. Keep activities practical for the class size and time. If tasks or durable lesson notes would help, show a draft and ask before saving or changing anything.'
  },
  {
    title: 'IELTS writing feedback',
    mode: 'review',
    description: 'Turn a learner draft into criteria-based feedback and a focused revision round.',
    path: 'Evidence · Feedback · Retry',
    prompt: 'Help me coach an IELTS Writing learner through a revision. Ask for the task prompt, the learner draft, their target band, and whether this is Task 1 or Task 2 if any are missing. Use specific evidence from the draft, explain the most useful improvements by criterion, and model only a short example before inviting the learner to revise. Do not invent a precise band score when the evidence is insufficient. Do not save notes or create tasks without showing me a draft and getting approval.'
  },
  {
    title: 'Focused study sprint',
    mode: 'goal',
    description: 'Turn one learning goal into a short, active session with a break and a quick self-check.',
    path: 'Focus · Practice · Recall',
    prompt: 'Help me plan one focused 25–45 minute study sprint. Ask for the subject, learner level, specific learning goal, and available time if they are missing. Use active recall or practice rather than passive rereading, include a short break if the session is long enough, and finish with a quick self-check. Keep the plan doable and suggest one next step. Do not add or reschedule tasks unless you show me the exact change and I approve it.'
  },
  {
    title: 'Research to lesson',
    mode: 'plan',
    description: 'Shape a research question, gather allowlisted sources, and turn supported findings into class material.',
    path: 'Question · Research · Vault',
    prompt: 'Help me turn a teaching topic into a source-backed lesson. Ask for the learner level, topic, curriculum or learning goal, and lesson time if they are missing. First propose a focused research question and a short evidence checklist. Do not fetch web pages automatically: guide me to the Research desk to add HTTPS sources from domains I have allowlisted in Settings. When I bring the captured sources back, separate supported findings from uncertainty, propose one practical learning activity, and prepare a reusable Knowledge Vault note. Ask before saving anything.'
  },
  {
    title: 'Weekly teacher reset',
    mode: 'goal',
    description: 'Review what is open, choose realistic priorities, and shape a calmer week.',
    path: 'Review · Prioritize · Prepare',
    prompt: 'Help me plan a realistic teacher productivity reset for the coming week. Ask which week and what constraints matter. If local Today tasks or the inbox are available, review them only through the approved local tools and summarize unfinished items before proposing changes. Group teaching, preparation, and personal commitments; help me choose at most three priorities and suggest protected focus blocks with buffer time. Show any proposed task or schedule changes for my approval before saving them.'
  },
  {
    title: 'Agent build cycle',
    mode: 'build',
    description: 'Move from a clear plan to an approved implementation and a concise review.',
    path: 'Plan · Approval · Build · Review',
    prompt: 'Work as a careful software build agent. Clarify the intended outcome, acceptance criteria, scope, and constraints when needed. Start by presenting a concise plan and the files or surfaces likely to change, then wait for my approval before editing files or starting side-effecting tools. After approval, implement the smallest complete change through the app’s existing permission gates, inspect the result, run relevant typecheck or build verification, and report what changed and what remains. Never claim a check passed unless it was run.'
  }
]

const MODE_LABELS: Partial<Record<ChatMode, string>> = {
  plan: 'Plan',
  review: 'Review',
  goal: 'Goal',
  build: 'Build'
}

export function WorkflowsView({ workflows, runningId, disabled, searchTargetId, onSearchTargetConsumed, onRun, onRemove, onLaunchPrompt }: WorkflowsViewProps): React.JSX.Element {
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [paramValues, setParamValues] = useState<Record<string, Record<string, string>>>({})

  useEffect(() => {
    if (!searchTargetId) return
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(`global-search-workflow-${searchTargetId}`)
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target?.focus({ preventScroll: true })
    })
    const timeout = window.setTimeout(() => onSearchTargetConsumed?.(), 4500)
    return () => { cancelAnimationFrame(frame); window.clearTimeout(timeout) }
  }, [searchTargetId, onSearchTargetConsumed])

  function setParam(workflowId: string, key: string, value: string): void {
    setParamValues((current) => ({
      ...current,
      [workflowId]: {
        ...(current[workflowId] ?? {}),
        [key]: value
      }
    }))
  }

  async function run(id: string): Promise<void> {
    setStatus(null)
    try {
      const result = await onRun(id, paramValues[id])
      setStatus({
        ok: result.ok,
        text: result.ok
          ? `Completed all ${result.completedSteps} workflow steps.`
          : `Stopped after ${result.completedSteps} of ${result.totalSteps} steps${result.error ? `: ${result.error}` : '.'}`
      })
    } catch (error) {
      setStatus({ ok: false, text: error instanceof Error ? error.message : String(error) })
    }
  }

  async function remove(id: string): Promise<void> {
    if (removingId !== id) {
      setRemovingId(id)
      return
    }
    setRemovingId(null)
    setStatus(null)
    try {
      const result = await onRemove(id)
      setStatus({ ok: result.ok, text: result.ok ? 'Workflow removed.' : result.error ?? 'Could not remove workflow.' })
    } catch (error) {
      setStatus({ ok: false, text: error instanceof Error ? error.message : String(error) })
    }
  }

  function launchPrompt(prompt: string, mode: ChatMode): void {
    setStatus(null)
    if (!onLaunchPrompt(prompt, mode)) {
      setStatus({ ok: false, text: 'Could not prepare this draft. Finish the current action or shorten the open chat draft, then try again.' })
    }
  }

  return (
    <div className="workflow-view">
      {status && <div className={`workflow-status ${status.ok ? 'status-ok' : 'status-error'}`} role={status.ok ? 'status' : 'alert'}>{status.text}</div>}

      <section className="workflow-starter-section" aria-labelledby="workflow-starters-title">
        <div className="workflow-section-heading">
          <div>
            <h3 id="workflow-starters-title">Guided workflows</h3>
            <p>Choose a starting point. It loads a draft in Chat; you review it and press Send when you are ready.</p>
          </div>
        </div>
        <div className="workflow-starters">
          {GUIDED_WORKFLOWS.map((flow) => (
            <article className="workflow-starter" key={flow.title}>
              <div className="workflow-starter-top"><span>{flow.path}</span><span>{MODE_LABELS[flow.mode]} mode</span></div>
              <h4>{flow.title}</h4>
              <p>{flow.description}</p>
              <button className="ghost-button" type="button" disabled={disabled} onClick={() => launchPrompt(flow.prompt, flow.mode)}>Prepare in Chat</button>
            </article>
          ))}
        </div>
      </section>

      <section className="workflow-saved-section" aria-labelledby="workflow-saved-title">
        <div className="workflow-section-heading">
          <div>
            <h3 id="workflow-saved-title">Saved workflows</h3>
            <p>Recorded local tool sequences are replayed through the permission gateway.</p>
          </div>
        </div>
        {workflows.length === 0 ? (
          <div className="workflow-empty">
            <strong>No saved workflows yet</strong>
            <p>Complete a tool-based task in Chat, then choose <strong>Save as workflow</strong>. Use <code>{'{{input}}'}</code> or <code>{'{{date}}'}</code> in step arguments to make a sequence reusable.</p>
          </div>
        ) : (
          <div className="workflow-list">
            {workflows.map((workflow) => {
            const params = extractWorkflowParameters(workflow.steps)
            return (
              <article
                id={`global-search-workflow-${workflow.id}`}
                className={`workflow-card ${searchTargetId === workflow.id ? 'is-global-search-target' : ''}`}
                key={workflow.id}
                tabIndex={searchTargetId === workflow.id ? -1 : undefined}
              >
                <div className="workflow-card-head">
                  <div>
                    <h3>{workflow.name}</h3>
                    <p>{workflow.prompt}</p>
                  </div>
                  <span className="workflow-step-count">{workflow.steps.length} steps</span>
                </div>
                <ol>
                  {workflow.steps.map((step, index) => (
                    <li key={`${workflow.id}-${index}`}>
                      <span>{step.summary || step.tool}</span>
                      <code>{step.tool}</code>
                    </li>
                  ))}
                </ol>
                {params.length > 0 && (
                  <div className="form-grid" style={{ marginTop: '0.75rem' }}>
                    {params.map((param) => (
                      <label className="field" key={param}>
                        <span className="field-label">{`{{${param}}}`}</span>
                        <input
                          value={paramValues[workflow.id]?.[param] ?? ''}
                          placeholder={param === 'date' ? new Date().toISOString().slice(0, 10) : `Value for ${param}`}
                          onChange={(event) => setParam(workflow.id, param, event.target.value)}
                        />
                      </label>
                    ))}
                  </div>
                )}
                <div className="workflow-actions">
                  <button className="primary-button" type="button" disabled={disabled || Boolean(runningId)} onClick={() => void run(workflow.id)}>
                    {runningId === workflow.id ? 'Running…' : 'Run workflow'}
                  </button>
                  <button className={`danger-button ${removingId === workflow.id ? 'confirming' : ''}`} type="button" disabled={disabled || Boolean(runningId)} onClick={() => void remove(workflow.id)}>
                    {removingId === workflow.id ? 'Confirm remove' : 'Remove'}
                  </button>
                  <span className="workflow-disclosure">Recorded arguments replay through the gateway; inspect each approval preview.</span>
                </div>
              </article>
            )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
