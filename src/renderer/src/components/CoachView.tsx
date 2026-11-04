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
  const [reflection, setReflection] = useState('')
  const [reviewKind, setReviewKind] = useState<'daily' | 'weekly'>('daily')
  const [saveReflection, setSaveReflection] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async (): Promise<void> => {
    const next = await window.assist.getCoachingContext()
    setContext(next)
    setStyle(next.profile.style)
    setRetention(next.profile.reflectionRetention)
    setBoundaries(next.profile.boundaries)
  }

  useEffect(() => { void load() }, [])

  const saveProfile = async (): Promise<void> => {
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await window.assist.updateCoachingProfile({ style, reflectionRetention: retention, boundaries })
      if (result.ok && result.context) { setContext(result.context); setNotice('Coaching preferences saved.') }
      else setError(result.error ?? 'Could not save coaching preferences.')
    } finally { setBusy(false) }
  }

  const createGoal = async (): Promise<void> => {
    setBusy(true); setError(''); setNotice('')
    try {
      const milestones = goalMilestones.split('\n').map((item) => item.trim()).filter(Boolean)
      const result = await window.assist.createCoachingGoal({ area, title: goalTitle, why: goalWhy, targetDate: goalDate || null, milestones })
      if (result.ok && result.context) {
        setContext(result.context); setGoalTitle(''); setGoalWhy(''); setGoalDate(''); setGoalMilestones(''); setNotice('Goal added after approval.')
      } else setError(result.error ?? 'The goal was not saved.')
    } finally { setBusy(false) }
  }

  const completeGoal = async (goal: CoachingGoal): Promise<void> => {
    const result = await window.assist.updateCoachingGoal(goal.id, { status: 'completed' })
    if (result.ok && result.context) { setContext(result.context); setNotice('Goal marked complete.') }
    else setError(result.error ?? 'Could not update that goal.')
  }

  const toggleGoalPause = async (goal: CoachingGoal): Promise<void> => {
    const status = goal.status === 'paused' ? 'active' : 'paused'
    const result = await window.assist.updateCoachingGoal(goal.id, { status })
    if (result.ok && result.context) {
      setContext(result.context)
      setNotice(status === 'active' ? 'Goal resumed.' : 'Goal paused.')
    } else setError(result.error ?? 'Could not update that goal.')
  }

  const toggleMilestone = async (goal: CoachingGoal, milestoneId: string): Promise<void> => {
    const milestones = goal.milestones.map((milestone) => milestone.id === milestoneId ? { ...milestone, done: !milestone.done } : milestone)
    const result = await window.assist.updateCoachingGoal(goal.id, { milestones })
    if (result.ok && result.context) { setContext(result.context); setNotice('Milestone updated.') }
    else setError(result.error ?? 'Could not update that milestone.')
  }

  const addMilestoneToToday = async (goal: CoachingGoal, milestoneTitle: string): Promise<void> => {
    const result = await window.assist.addPlanTask({ title: milestoneTitle, notes: `Next step for coaching goal: ${goal.title}`, sourceGoalId: goal.id })
    if (result.ok) setNotice('Milestone added to Today.')
    else setError(result.error ?? 'Could not add that milestone to Today.')
  }

  const submitReflection = async (): Promise<void> => {
    const body = reflection.trim()
    if (!body || busy) return
    setError('')
    if (!saveReflection) {
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

  return (
    <div className="coach-view">
      <div className="coach-header">
        <div>
          <span className="eyebrow">Smart life coaching</span>
          <h2>Coach</h2>
          <p>Personal life and Business / LB English have separate goals, saved reflections, and coach chats.</p>
        </div>
        <div className="coach-header-actions">
          <button className="ghost-button" type="button" onClick={() => onStart(area, reviewPrompt)}>Review with AI</button>
          <button className="primary-button" type="button" onClick={() => onStart(area, startPrompt)}>Start coaching chat</button>
        </div>
      </div>

      <div className="coach-area-tabs" role="tablist">
        <button type="button" className={area === 'personal' ? 'active' : ''} onClick={() => setArea('personal')}>Personal life<span>Goals, energy, relationships</span></button>
        <button type="button" className={area === 'lb_english' ? 'active' : ''} onClick={() => setArea('lb_english')}>Business / LB English<span>Teaching, IELTS, operations</span></button>
      </div>

      <div className="coach-grid">
        <section className="coach-card coach-profile">
          <div className="coach-card-head"><div><span className="eyebrow">Control room</span><h3>Coaching preferences</h3></div><span className="privacy-chip">Private by default</span></div>
          <label>Style<select value={style} onChange={(event) => setStyle(event.target.value as typeof style)}><option value="supportive">Supportive</option><option value="direct">Direct and concise</option><option value="socratic">Socratic questions</option></select></label>
          <label>Reflection retention<select value={retention} onChange={(event) => setRetention(event.target.value as typeof retention)}><option value="ephemeral">Ephemeral unless I save it</option><option value="journal">Offer private journal continuity</option></select></label>
          <label>Boundaries<textarea value={boundaries} onChange={(event) => setBoundaries(event.target.value)} rows={3} /></label>
          <button className="ghost-button" type="button" disabled={busy} onClick={() => void saveProfile()}>Save preferences</button>
        </section>

        <section className="coach-card coach-goals">
          <div className="coach-card-head"><div><span className="eyebrow">{AREA_LABELS[area]}</span><h3>Goals</h3></div><span className="count-badge">{areaGoals.length}</span></div>
          <div className="coach-goal-list">
            {areaGoals.map((goal) => <div className="coach-goal" key={goal.id}><div><strong>{goal.title}</strong><span>{goal.status === 'paused' ? 'Paused' : 'Active'}</span>{goal.why && <p>{goal.why}</p>}{goal.targetDate && <span>Target {goal.targetDate}</span>}{goal.milestones.length > 0 && <div className="coach-milestones">{goal.milestones.map((milestone) => <label key={milestone.id} className={milestone.done ? 'done' : ''}><input type="checkbox" checked={milestone.done} onChange={() => void toggleMilestone(goal, milestone.id)} />{milestone.title}<button type="button" className="milestone-plan" onClick={() => void addMilestoneToToday(goal, milestone.title)}>Today</button></label>)}</div>}</div><div className="coach-goal-actions"><button className="ghost-button" type="button" onClick={() => void toggleGoalPause(goal)}>{goal.status === 'paused' ? 'Resume' : 'Pause'}</button><button className="ghost-button" type="button" onClick={() => void completeGoal(goal)}>Complete</button></div></div>)}
            {areaGoals.length === 0 && <p className="muted">No goals in this area yet.</p>}
          </div>
          <div className="coach-goal-form"><input value={goalTitle} onChange={(event) => setGoalTitle(event.target.value)} placeholder={`New ${AREA_LABELS[area].toLowerCase()} goal`} aria-label="Coaching goal" /><input value={goalWhy} onChange={(event) => setGoalWhy(event.target.value)} placeholder="Why does this matter?" aria-label="Goal motivation" /><input type="date" value={goalDate} onChange={(event) => setGoalDate(event.target.value)} aria-label="Goal target date" /><button className="primary-button" type="button" disabled={busy || !goalTitle.trim()} onClick={() => void createGoal()}>Add goal</button><textarea value={goalMilestones} onChange={(event) => setGoalMilestones(event.target.value)} placeholder="Milestones, one per line (optional)" aria-label="Goal milestones" rows={2} /></div>
        </section>

        <section className="coach-card coach-checkin">
          <div className="coach-card-head"><div><span className="eyebrow">No pressure</span><h3>{reviewKind === 'daily' ? 'Daily check-in' : 'Weekly review'}</h3></div><select value={reviewKind} onChange={(event) => setReviewKind(event.target.value as typeof reviewKind)}><option value="daily">Daily check-in</option><option value="weekly">Weekly review</option></select></div>
          <p className="coach-prompt">{reviewKind === 'daily' ? 'What matters most today, and what might get in the way?' : 'What worked, what created friction, and what will you adjust next week?'}</p>
          <textarea value={reflection} onChange={(event) => setReflection(event.target.value)} rows={6} placeholder="Write only what feels useful…" aria-label="Coaching reflection" />
          <label className="coach-save-toggle"><input type="checkbox" checked={saveReflection} onChange={(event) => setSaveReflection(event.target.checked)} /> Save this reflection to the private journal (requires approval)</label>
          <button className="primary-button" type="button" disabled={busy || !reflection.trim()} onClick={() => void submitReflection()}>{busy ? 'Saving…' : saveReflection ? 'Save reflection' : 'Discuss with AI coach'}</button>
          <p className="muted">{saveReflection ? 'Saving stores this in the private journal after approval. Saved entries can be included in later coach chats.' : 'Discussing sends this text to your configured model and keeps it in local chat history. Leave it here to keep it out of both.'}</p>
        </section>

        <section className="coach-card coach-journal">
          <div className="coach-card-head"><div><span className="eyebrow">Continuity you chose</span><h3>Saved journal</h3></div><span className="privacy-chip">{savedJournal.length} entries</span></div>
          {savedJournal.slice(0, 4).map((entry) => <article className="coach-journal-entry" key={entry.id}><span>{entry.kind} · {new Date(entry.createdAt).toLocaleDateString()}</span><p>{entry.body}</p></article>)}
          {savedJournal.length === 0 && <p className="muted">Saved reflections will appear here. Unsaved check-ins never enter the journal.</p>}
        </section>
      </div>
      {(error || notice) && <p className={`coach-status ${error ? 'status-error' : 'status-ok'}`}>{error || notice}</p>}
    </div>
  )
}
