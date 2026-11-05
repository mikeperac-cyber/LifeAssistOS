import { useEffect, useState } from 'react'
import type { WorkflowRecord } from '../../../shared/types'
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
  onCancel: () => void
}

export function WorkflowsView({ workflows, runningId, disabled, searchTargetId, onSearchTargetConsumed, onRun, onRemove, onCancel }: WorkflowsViewProps): React.JSX.Element {
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

  return (
    <div className="workflow-view">
      <header className="workflow-header">
        <div>
          <div className="eyebrow">REUSABLE STEPS</div>
          <h2>Workflows</h2>
          <p>Save successful local tool sequences from Chat, then replay them step-by-step through the gateway. Use <code>{'{{input}}'}</code> or <code>{'{{date}}'}</code> in step arguments for reusable templates.</p>
        </div>
        {runningId && <button className="stop-button" type="button" onClick={onCancel}>Stop workflow</button>}
      </header>

      {status && <div className={`workflow-status ${status.ok ? 'status-ok' : 'status-error'}`} role={status.ok ? 'status' : 'alert'}>{status.text}</div>}

      {workflows.length === 0 ? (
        <div className="finance-empty workflow-empty">
          Complete a tool-based task in Chat, then choose <strong>Save as workflow</strong>. Local file, note, planning, vault, finance, memory, and coaching steps can be saved; external web/email/calendar actions are excluded.
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
    </div>
  )
}
