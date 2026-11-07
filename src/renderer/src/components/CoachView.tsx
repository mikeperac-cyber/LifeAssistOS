import { useEffect, useState } from 'react'
import type { CoachArea, CoachingContext, CoachingGoal } from '../../../shared/types'

const AREA_LABELS: Record<CoachArea, string> = { personal: 'Personal life', lb_english: 'Business / LB English' }

export function CoachView({ onStart }: { onStart: (area: CoachArea, prompt: string) => void }): React.JSX.Element {
  const [context, setContext] = useState<CoachingContext | null>(null)
  const [area, setArea] = useState<CoachArea>('personal')
  const [style, setStyle] = useState<'supportive' | 'direct' | 'socratic'>('supportive')
  const [retention, setRetention] = useState<'ephemeral' | 'journal'>('ephemeral')
  const [boundaries, setBoundaries] = useState('')
  const [goalTitle, setGoalTitle] = useState('')
  const [goalWhy, setGoalWhy] = useState('')
  const [goalDate, setGoalDate] = useState('')
  const [goalMilestones, setGoalMilestones] = useState('')
  const [goalFormOpen, setGoalFormOpen] = useState(false)
  const [reflection, setReflection] = useState('')
  const [reviewKind, setReviewKind] = useState<'daily' | 'weekly'>('daily')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const load = async (): Promise<void> => {
    setLoading(true)
    setLoadError('')
    try {
      const next = await window.assist.getCoachingContext()
      setContext(next)
      setStyle(next.profile.style)
      setRetention(next.profile.reflectionRetention)
      setBoundaries(next.profile.boundaries)
    } catch (cause) {
      setLoadError(errorText(cause, 'Could not load coaching preferences.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const saveProfile = async (): Promise<void> => {
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await window.assist.updateCoachingProfile({ style, reflectionRetention: retention, boundaries })
      if (result.ok && result.context) { setContext(result.context); setNotice('Coaching preferences saved.') }
      else setError(result.error ?? 'Could not save coaching preferences.')
    } catch (cause) {
      setError(errorText(cause, 'Could not save coaching preferences.'))
    } finally { setBusy(false) }
  }

  const createGoal = async (): Promise<void> => {
    setBusy(true); setError(''); setNotice('')
    try {
      const milestones = goalMilestones.split('\n').map((item) => item.trim()).filter(Boolean)
      const result = await window.assist.createCoachingGoal({ area, title: goalTitle, why: goalWhy, targetDate: goalDate || null, milestones })
      if (result.ok && result.context) {
        setContext(result.context); setGoalTitle(''); setGoalWhy(''); setGoalDate(''); setGoalMilestones(''); setGoalFormOpen(false); setNotice('Goal added after approval.')
      } else setError(result.error ?? 'The goal was not saved.')
    } catch (cause) {
      setError(errorText(cause, 'The goal was not saved.'))
    } finally { setBusy(false) }
  }

  const completeGoal = async (goal: CoachingGoal): Promise<void> => {
    try {
      const result = await window.assist.updateCoachingGoal(goal.id, { status: 'completed' })
      if (result.ok && result.context) { setContext(result.context); setNotice('Goal marked complete.') }
      else setError(result.error ?? 'Could not update that goal.')
    } catch (cause) {
      setError(errorText(cause, 'Could not update that goal.'))
    }
  }

  const toggleGoalPause = async (goal: CoachingGoal): Promise<void> => {
    const status = goal.status === 'paused' ? 'active' : 'paused'
    try {
      const result = await window.assist.updateCoachingGoal(goal.id, { status })
      if (result.ok && result.context) {
        setContext(result.context)
        setNotice(status === 'active' ? 'Goal resumed.' : 'Goal paused.')
      } else setError(result.error ?? 'Could not update that goal.')
    } catch (cause) {
      setError(errorText(cause, 'Could not update that goal.'))
    }
  }

  const toggleMilestone = async (goal: CoachingGoal, milestoneId: string): Promise<void> => {
    const milestones = goal.milestones.map((milestone) => milestone.id === milestoneId ? { ...milestone, done: !milestone.done } : milestone)
    try {
      const result = await window.assist.updateCoachingGoal(goal.id, { milestones })
      if (result.ok && result.context) { setContext(result.context); setNotice('Milestone updated.') }
      else setError(result.error ?? 'Could not update that milestone.')
    } catch (cause) {
      setError(errorText(cause, 'Could not update that milestone.'))
    }
  }

  const addMilestoneToToday = async (goal: CoachingGoal, milestoneTitle: string): Promise<void> => {
    try {
      const result = await window.assist.addPlanTask({ title: milestoneTitle, notes: `Next step for coaching goal: ${goal.title}`, sourceGoalId: goal.id })
      if (result.ok) setNotice('Milestone added to Today.')
      else setError(result.error ?? 'Could not add that milestone to Today.')
    } catch (cause) {
      setError(errorText(cause, 'Could not add that milestone to Today.'))
    }
  }

  const submitReflection = async (savePrivately: boolean): Promise<void> => {
    const body = reflection.trim()
    if (!body || busy) return
    setError('')
    if (!savePrivately) {
      const contextLabel = AREA_LABELS[area]
      const prompt = `Respond to my ${reviewKind === 'daily' ? 'daily check-in' : 'weekly review'} in ${contextLabel} coach mode. Reflect the main point briefly, help me identify one realistic next step, and ask at most one focused question. Do not save this reflection.\n\nMy reflection:\n${body}`
      setReflection('')
      onStart(area, prompt)
      return
    }
    setBusy(true)
    setNotice('Saving privately — approve the card to confirm.')
    try {
      const result = await window.assist.saveCoachingJournal({ area, kind: reviewKind, body })
      if (result.ok) { setReflection(''); await load(); setNotice('Saved to the private coaching journal.') }
      else setError(result.error ?? 'The reflection was not saved.')
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const areaGoals = context?.goals.filter((goal) => goal.area === area) ?? []
  const savedJournal = context?.journal.filter((entry) => entry.area === area) ?? []
  const startPrompt = area === 'personal'
    ? 'Act as my personal life coach. Help me choose one realistic next step from my current goals, ask one useful question, and respect my boundaries. Do not diagnose or guilt me.'
    : 'Act as my Business / LB English coach. Help me choose one realistic next step for my teaching, IELTS, or business work, ask one useful question, and keep the plan practical for my actual week.'
  const reviewPrompt = area === 'personal'
    ? 'Review my saved Personal life coaching context. Summarize progress without judgment, identify one pattern only if the evidence supports it, and suggest no more than three realistic next actions. Ask one focused question. Do not diagnose, guilt, or save anything.'
    : 'Review my saved Business / LB English coaching context. Summarize progress without judgment, identify one useful business, teaching, or IELTS pattern only if the evidence supports it, and suggest no more than three realistic next actions. Ask one focused question. Do not diagnose, guilt, or save anything.'

  const handleAreaTabKey = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    const nextArea = getNextCoachArea(area, event.key)
    if (!nextArea) return
    event.preventDefault()
    setArea(nextArea)
    window.requestAnimationFrame(() => document.getElementById(`coach-area-tab-${nextArea}`)?.focus())
  }

  if (!context) {
    return (
      <div className="coach-view">
        <div className="coach-header">
          <div><h2>Your coaching space</h2></div>
        </div>
        {loading ? (
          <p className="muted" role="status">Loading saved coaching preferences and goals…</p>
        ) : (
          <div className="coach-load-error">
            <p role="alert">{loadError || 'Saved coaching context is not available.'}</p>
            <button className="ghost-button" type="button" onClick={() => void load()}>Retry</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="coach-view">
      <div className="coach-header">
        <div>
          <h2>Your coaching space</h2>
          <p>Check in, work toward goals, and choose what belongs in your journal.</p>
        </div>
        <div className="coach-header-actions">
          <button className="ghost-button" type="button" onClick={() => onStart(area, reviewPrompt)}>Review progress</button>
          <button className="primary-button" type="button" onClick={() => onStart(area, startPrompt)}>Start coaching chat</button>
        </div>
      </div>

      <div className="coach-area-tabs" role="tablist" aria-label="Coaching area">
        <button id="coach-area-tab-personal" type="button" role="tab" aria-selected={area === 'personal'} aria-controls="coach-area-panel" tabIndex={area === 'personal' ? 0 : -1} className={area === 'personal' ? 'active' : ''} onClick={() => setArea('personal')} onKeyDown={handleAreaTabKey}>Personal life<span>Goals, energy, relationships</span></button>
        <button id="coach-area-tab-lb_english" type="button" role="tab" aria-selected={area === 'lb_english'} aria-controls="coach-area-panel" tabIndex={area === 'lb_english' ? 0 : -1} className={area === 'lb_english' ? 'active' : ''} onClick={() => setArea('lb_english')} onKeyDown={handleAreaTabKey}>Business / LB English<span>Teaching, IELTS, operations</span></button>
      </div>

      {loadError && <div className="coach-load-error"><p role="alert">{loadError}</p><button className="ghost-button" type="button" onClick={() => void load()}>Retry</button></div>}
      <div className="coach-grid" id="coach-area-panel" role="tabpanel" aria-labelledby={`coach-area-tab-${area}`} tabIndex={0}>
        <div className="coach-column coach-primary-column">
        <section className="coach-card coach-checkin">
          <div className="coach-card-head">
            <h3>{reviewKind === 'daily' ? 'Daily check-in' : 'Weekly review'}</h3>
            <div className="coach-review-switch" role="group" aria-label="Reflection period">
              <button type="button" aria-pressed={reviewKind === 'daily'} onClick={() => setReviewKind('daily')}>Daily</button>
              <button type="button" aria-pressed={reviewKind === 'weekly'} onClick={() => setReviewKind('weekly')}>Weekly</button>
            </div>
          </div>
          <p className="coach-prompt">{reviewKind === 'daily' ? 'What matters most today, and what might get in the way?' : 'What worked, what created friction, and what will you adjust next week?'}</p>
          <label className="coach-reflection-field"><span>Your reflection</span><textarea value={reflection} onChange={(event) => setReflection(event.target.value)} rows={4} placeholder="Write only what feels useful…" aria-label="Coaching reflection" /></label>
          <div className="coach-reflection-actions">
            <button className="primary-button" type="button" disabled={busy || !reflection.trim()} onClick={() => void submitReflection(false)}>Discuss with coach</button>
            <button className="ghost-button" type="button" disabled={busy || !reflection.trim()} onClick={() => void submitReflection(true)}>{busy ? 'Saving…' : 'Save privately'}</button>
          </div>
          <p className="coach-disclosure">Discussing sends this text to your configured model and saves it in local chat history. Private journal saves require approval and can be included in later coach chats.</p>
        </section>

        <section className="coach-card coach-journal">
          <div className="coach-card-head"><h3>Saved journal</h3><span className="privacy-chip">{savedJournal.length} entries</span></div>
          {savedJournal.slice(0, 4).map((entry) => <article className="coach-journal-entry" key={entry.id}><span>{entry.kind} · {new Date(entry.createdAt).toLocaleDateString()}</span><p>{entry.body}</p></article>)}
          {savedJournal.length === 0 && <p className="muted coach-journal-empty">No saved reflections in {AREA_LABELS[area]}. Unsaved check-ins stay out of this journal.</p>}
        </section>

        </div>
        <div className="coach-column coach-secondary-column">
        <section className="coach-card coach-goals">
          <div className="coach-card-head">
            <div><h3>Goals</h3><span className="coach-goal-area">{AREA_LABELS[area]}</span></div>
            <div className="coach-goal-heading-actions"><span className="coach-goal-count">{areaGoals.length}</span><button className="ghost-button" type="button" aria-expanded={goalFormOpen} onClick={() => setGoalFormOpen((open) => !open)}>{goalFormOpen ? 'Close form' : 'Add a goal'}</button></div>
          </div>
          <div className="coach-goal-list">
            {areaGoals.map((goal) => <div className="coach-goal" key={goal.id}><div><strong>{goal.title}</strong><span>{goal.status === 'paused' ? 'Paused' : 'Active'}</span>{goal.why && <p>{goal.why}</p>}{goal.targetDate && <span>Target {goal.targetDate}</span>}{goal.milestones.length > 0 && <div className="coach-milestones">{goal.milestones.map((milestone) => <label key={milestone.id} className={milestone.done ? 'done' : ''}><input type="checkbox" checked={milestone.done} onChange={() => void toggleMilestone(goal, milestone.id)} />{milestone.title}<button type="button" className="milestone-plan" onClick={() => void addMilestoneToToday(goal, milestone.title)}>Today</button></label>)}</div>}</div><div className="coach-goal-actions"><button className="ghost-button" type="button" onClick={() => void toggleGoalPause(goal)}>{goal.status === 'paused' ? 'Resume' : 'Pause'}</button><button className="ghost-button" type="button" onClick={() => void completeGoal(goal)}>Complete</button></div></div>)}
            {areaGoals.length === 0 && <p className="muted coach-goals-empty">No goals yet in {AREA_LABELS[area]}. Add one when you’re ready.</p>}
          </div>
          {goalFormOpen && <form className="coach-goal-form" id="coach-goal-form" onSubmit={(event) => { event.preventDefault(); void createGoal() }}>
            <label>Goal title<input required value={goalTitle} onChange={(event) => setGoalTitle(event.target.value)} placeholder="What would you like to work toward?" /></label>
            <label>Why it matters<input value={goalWhy} onChange={(event) => setGoalWhy(event.target.value)} placeholder="Optional motivation" /></label>
            <label>Target date<input type="date" value={goalDate} onChange={(event) => setGoalDate(event.target.value)} /></label>
            <label className="coach-goal-milestones">Milestones (optional)<textarea value={goalMilestones} onChange={(event) => setGoalMilestones(event.target.value)} placeholder="One milestone per line" rows={2} /></label>
            <p className="coach-form-note">Saving a goal requires approval.</p>
            <div className="coach-goal-form-actions"><button className="primary-button" type="submit" disabled={busy || !goalTitle.trim()}>Add goal</button></div>
          </form>}
        </section>

        <section className="coach-card coach-profile">
          <details className="coach-preferences">
            <summary><span className="coach-preferences-title"><strong>Coaching preferences</strong><span>Response style, reflection retention, and boundaries</span></span><span className="privacy-chip">Private by default</span></summary>
            <div className="coach-preferences-fields">
              <label>Response style<select value={style} onChange={(event) => setStyle(event.target.value as typeof style)}><option value="supportive">Supportive</option><option value="direct">Direct and concise</option><option value="socratic">Socratic questions</option></select></label>
              <label>Reflection retention<select value={retention} onChange={(event) => setRetention(event.target.value as typeof retention)}><option value="ephemeral">Ephemeral unless I save it</option><option value="journal">Offer private journal continuity</option></select></label>
              <label className="coach-boundaries">Boundaries<textarea value={boundaries} onChange={(event) => setBoundaries(event.target.value)} rows={3} /></label>
              <button className="ghost-button" type="button" disabled={busy} onClick={() => void saveProfile()}>Save preferences</button>
            </div>
          </details>
        </section>
        </div>
      </div>
      {(error || notice) && <p className={`coach-status ${error ? 'status-error' : 'status-ok'}`} role={error ? 'alert' : 'status'}>{error || notice}</p>}
    </div>
  )
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : typeof error === 'string' && error ? error : fallback
}

export function getNextCoachArea(area: CoachArea, key: string): CoachArea | null {
  const areas: CoachArea[] = ['personal', 'lb_english']
  const currentIndex = areas.indexOf(area)
  if (currentIndex < 0) return null
  if (key === 'Home') return areas[0]
  if (key === 'End') return areas[areas.length - 1]
  if (key === 'ArrowRight') return areas[(currentIndex + 1) % areas.length]
  if (key === 'ArrowLeft') return areas[(currentIndex - 1 + areas.length) % areas.length]
  return null
}
