import { useEffect, useState } from 'react'
import type { AssistantSkill, AssistantSkillInput, AssistantSkillScope } from '../../../shared/types'
import type { SkillMutationResult } from '../../../shared/ipc'

interface Draft {
  id?: string
  name: string
  description: string
  scope: AssistantSkillScope
  instructions: string
}

const EMPTY_DRAFT: Draft = { name: '', description: '', scope: 'general', instructions: '' }
const SCOPE_LABELS: Record<AssistantSkillScope, string> = {
  general: 'General',
  personal: 'Personal life',
  business: 'Business',
  coding: 'Coding',
  education: 'Education',
  research: 'Research'
}
const STARTERS: Array<Draft & { shortLabel: string }> = [
  {
    shortLabel: 'Personal check-in',
    name: 'Gentle personal check-in',
    description: 'Use when reflecting on personal goals or choosing a manageable next step.',
    scope: 'personal',
    instructions: 'Begin with one supportive, nonjudgmental question. Separate what the user said from your interpretation. Offer one small next step. Ask before saving reflections or changing goals.'
  },
  {
    shortLabel: 'LB English review',
    name: 'LB English weekly review',
    description: 'Use when prioritizing LB English teaching and business work.',
    scope: 'business',
    instructions: 'Help choose one measurable priority that fits the user’s available time. Distinguish recorded results from estimates and assumptions. Identify deadlines or dependencies, then suggest one concrete next action.'
  },
  {
    shortLabel: 'IELTS feedback',
    name: 'IELTS Task 2 feedback',
    description: 'Use when reviewing IELTS Academic Writing Task 2 essays.',
    scope: 'education',
    instructions: 'Review task response, coherence and cohesion, lexical resource, and grammatical range and accuracy. Give evidence from the essay, prioritize three revisions, and avoid promising an exact exam score.'
  },
  {
    shortLabel: 'Code review',
    name: 'Focused code review',
    description: 'Use for source code reviews where the user asks for findings.',
    scope: 'coding',
    instructions: 'Inspect the changed code and relevant surrounding context. Prioritize correctness, security, and regressions. Report findings with exact file and line evidence. Keep review read-only unless the user separately requests a fix.'
  }
]

export function SkillsView({
  skills,
  disabled,
  onSave,
  onToggle,
  onDelete
}: {
  skills: AssistantSkill[]
  disabled: boolean
  onSave: (input: AssistantSkillInput) => Promise<SkillMutationResult>
  onToggle: (id: string, enabled: boolean) => Promise<SkillMutationResult>
  onDelete: (id: string) => Promise<SkillMutationResult>
}): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (selectedId === 'new') return
    const selected = skills.find((skill) => skill.id === selectedId)
    if (selected) {
      setDraft(toDraft(selected))
    } else if (selectedId) {
      setSelectedId(null)
    } else if (skills.length > 0) {
      setSelectedId(skills[0].id)
    }
  }, [skills, selectedId])

  const selected = skills.find((skill) => skill.id === selectedId)
  const isNew = selectedId === 'new'

  function startNew(): void {
    setDraft(EMPTY_DRAFT)
    setSelectedId('new')
    setConfirmDelete(false)
    setStatus('')
  }

  function select(skill: AssistantSkill): void {
    setSelectedId(skill.id)
    setConfirmDelete(false)
    setStatus('')
  }

  async function save(): Promise<void> {
    setBusy(true)
    setStatus('')
    try {
      const input: AssistantSkillInput = {
        id: isNew ? undefined : draft.id,
        name: draft.name,
        description: draft.description,
        scope: draft.scope,
        instructions: draft.instructions
      }
      const result = await onSave(input)
      const saved = result.skills?.find((skill) => skill.id === input.id || skill.name.toLocaleLowerCase() === input.name.trim().toLocaleLowerCase())
      if (result.ok && saved) {
        setSelectedId(saved.id)
        setStatus('Skill saved. The assistant can load it when it matches a request.')
      } else {
        setStatus(result.error ?? 'Could not save the skill.')
      }
    } catch (error) {
      setStatus(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  async function toggle(): Promise<void> {
    if (!selected) return
    setBusy(true)
    setStatus('')
    try {
      const result = await onToggle(selected.id, !selected.enabled)
      setStatus(result.ok ? (selected.enabled ? 'Skill disabled.' : 'Skill enabled.') : result.error ?? 'Could not update the skill.')
    } catch (error) {
      setStatus(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  async function remove(): Promise<void> {
    if (!selected) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setBusy(true)
    setStatus('')
    try {
      const result = await onDelete(selected.id)
      setStatus(result.ok ? 'Skill deleted.' : result.error ?? 'Could not delete the skill.')
      if (result.ok) {
        setSelectedId(null)
        setDraft(EMPTY_DRAFT)
      }
    } catch (error) {
      setStatus(errorText(error))
    } finally {
      setBusy(false)
      setConfirmDelete(false)
    }
  }

  return (
    <div className="skills-view">
      <header className="skills-header">
        <div>
          <span className="eyebrow">Reusable guidance</span>
          <h2>Teach Mike Assist how you work</h2>
          <p>Create focused instructions for coding, teaching, research, business, or personal routines. The assistant sees each enabled skill’s summary and loads the full text only when it is relevant.</p>
        </div>
        <button className="primary-button" type="button" onClick={startNew} disabled={disabled || busy || skills.length >= 24}>New skill</button>
      </header>

      <p className="skill-privacy-note">Skills are plain text, never executable, and cannot grant extra permissions. A loaded skill is included in the active model request; a remote provider receives that context. Personal coach sees Personal and General skills; Business coach sees Business, Education, and General skills.</p>

      <div className="skills-layout">
        <aside className="skills-list" aria-label="Saved skills">
          {skills.map((skill) => (
            <button key={skill.id} type="button" aria-pressed={selectedId === skill.id} className={`skill-list-item ${selectedId === skill.id ? 'active' : ''}`} onClick={() => select(skill)} disabled={disabled || busy}>
              <span className="skill-list-name">{skill.name}</span>
              <span className="skill-list-meta">{SCOPE_LABELS[skill.scope]} · {skill.enabled ? 'enabled' : 'disabled'}</span>
              <span className="skill-list-description">{skill.description}</span>
            </button>
          ))}
          {skills.length === 0 && <p className="muted skill-empty-list">No skills yet. Add a guide for how you like work done.</p>}
        </aside>

        <section className="skill-editor" aria-label={isNew ? 'Create skill' : 'Edit skill'}>
          <div className="skill-editor-head">
            <div>
              <span className="eyebrow">{isNew ? 'New skill' : selected ? SCOPE_LABELS[selected.scope] : 'Skill editor'}</span>
              <h3>{isNew ? 'Create a reusable skill' : selected?.name ?? 'Choose a skill'}</h3>
            </div>
            {selected && <button className="ghost-button" type="button" onClick={() => void toggle()} disabled={disabled || busy}>{selected.enabled ? 'Disable' : 'Enable'}</button>}
          </div>
          {selected || isNew ? (
            <>
              {isNew && !draft.instructions && (
                <div className="skill-starters">
                  <span className="field-label">Start from a template · editable and unsaved</span>
                  <div>
                    {STARTERS.map((starter) => (
                      <button key={starter.shortLabel} className="ghost-button" type="button" disabled={disabled || busy} onClick={() => setDraft({ ...starter, id: undefined })}>
                        {starter.shortLabel}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <label className="field">
                <span className="field-label">Name</span>
                <input value={draft.name} maxLength={64} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="IELTS writing feedback" disabled={disabled || busy} />
              </label>
              <label className="field">
                <span className="field-label">When should the assistant use it?</span>
                <input value={draft.description} maxLength={240} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Use when reviewing an IELTS Task 2 essay." disabled={disabled || busy} />
              </label>
              <label className="field">
                <span className="field-label">Category</span>
                <select value={draft.scope} onChange={(event) => setDraft((current) => ({ ...current, scope: event.target.value as AssistantSkillScope }))} disabled={disabled || busy}>
                  {Object.entries(SCOPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Instructions</span>
                <textarea className="skill-instructions" value={draft.instructions} maxLength={7000} onChange={(event) => setDraft((current) => ({ ...current, instructions: event.target.value }))} placeholder={'Explain the steps and standards the assistant should use.\n\nExample: Identify the thesis, assess each paragraph against the prompt, and give three priority fixes before sentence-level edits.'} disabled={disabled || busy} />
                <span className="field-hint">{draft.instructions.length.toLocaleString()} / 7,000 characters</span>
              </label>
              <div className="skill-editor-actions">
                <button className="primary-button" type="button" onClick={() => void save()} disabled={disabled || busy || !draft.name.trim() || !draft.description.trim() || !draft.instructions.trim()}>{busy ? 'Saving…' : 'Save skill'}</button>
                {selected && <button className={`danger-button ${confirmDelete ? 'confirming' : ''}`} type="button" onClick={() => void remove()} disabled={disabled || busy}>{confirmDelete ? 'Confirm delete' : 'Delete'}</button>}
                {status && <span className="skill-status" role="status">{status}</span>}
              </div>
            </>
          ) : (
            <p className="muted">Select a saved skill or create a new one.</p>
          )}
        </section>
      </div>
    </div>
  )
}

function toDraft(skill: AssistantSkill): Draft {
  return { id: skill.id, name: skill.name, description: skill.description, scope: skill.scope, instructions: skill.instructions }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
