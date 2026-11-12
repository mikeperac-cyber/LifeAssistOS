import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReviewTaskFilter, ReviewViewModel } from './review-view-model'
import { addDays, buildReviewViewModel } from './review-view-model'
import { Icon } from './Icon'

export function ReviewView({ refreshVersion, onOpenTasks, onOpenProjects, onOpenAssistant, onQuickCapture }: {
  refreshVersion: number
  onOpenTasks: (filter: ReviewTaskFilter) => void
  onOpenProjects: () => void
  onOpenAssistant: (prompt: string) => void
  onQuickCapture: () => void
}): React.JSX.Element {
  const [review, setReview] = useState<ReviewViewModel | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const [snapshot, workspace] = await Promise.all([window.assist.getToday(), window.assist.getProjectWorkspace()])
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      setReview(buildReviewViewModel({
        today: snapshot.date || getLocalDate(),
        timeZone,
        inbox: snapshot.inbox,
        tasks: workspace.tasks,
        projects: workspace.projects,
        areas: workspace.areas
      }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load your weekly review.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh, refreshVersion])
  useEffect(() => {
    const unsubscribe = window.assist.onEvent((event) => { if (event.type === 'today_changed') void refresh() })
    const onFocus = (): void => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => { unsubscribe(); window.removeEventListener('focus', onFocus) }
  }, [refresh])

  const headline = useMemo(() => {
    if (!review) return ''
    const attentionCount = review.overdue.length + review.dueSoon.length + review.waiting.length + review.inbox.length
    if (!attentionCount) return 'Your week looks clear. Choose what you want to make room for next.'
    if (review.overdue.length) return `${review.overdue.length} overdue ${plural(review.overdue.length, 'task')} need a decision. Start there, then plan the week ahead.`
    if (review.inbox.length) return `${review.inbox.length} ${plural(review.inbox.length, 'thought')} are waiting in your Inbox. Clear one before adding more.`
    if (review.waiting.length) return `${review.waiting.length} ${plural(review.waiting.length, 'task')} are waiting. Decide what would unblock the next one.`
    return `${review.dueSoon.length} ${plural(review.dueSoon.length, 'task')} are due in the next seven days. Give the most important one a place in My Day.`
  }, [review])

  if (loading && !review) return <section className="review-loading" role="status">Preparing your review…</section>
  if (error && !review) return <section className="review-loading review-load-error" role="alert"><p>{error}</p><button className="ghost-button" type="button" onClick={() => void refresh()}>Retry</button></section>
  if (!review) return <section className="review-loading" role="status">Your review is unavailable.</section>

  const maxWeeklyCount = Math.max(1, ...review.completedWeeks.map((week) => week.count))

  return (
    <section className="review-view" aria-labelledby="review-title" aria-busy={loading}>
      {error && <div className="review-inline-error" role="alert">{error}<button type="button" onClick={() => void refresh()}>Retry</button></div>}
      <div className="review-content">
        <header className="review-hero">
          <div className="review-hero-copy">
            <div className="review-eyebrow"><Icon name="review" /> Weekly review <span>{formatRange(review.weekStart, addDays(review.weekStart, 6))}</span></div>
            <h2 id="review-title">Take stock, then choose your next step.</h2>
            <p>{headline}</p>
          </div>
          <div className="review-hero-actions">
            <button className="primary-button" type="button" onClick={() => onOpenTasks('my-day')}><Icon name="calendar" /> Plan My Day</button>
            <button className="ghost-button" type="button" onClick={onQuickCapture}><Icon name="plus" /> Capture a thought</button>
          </div>
        </header>

        <div className="review-metrics" aria-label="This week's task overview">
          <Metric icon="inbox" label="Inbox" count={review.inbox.length} hint="thoughts to sort" onClick={() => onOpenTasks('inbox')} />
          <Metric icon="alert" label="Overdue" count={review.overdue.length} hint="open tasks" onClick={() => onOpenTasks('overdue')} tone={review.overdue.length ? 'warm' : undefined} />
          <Metric icon="calendar" label="Due this week" count={review.dueSoon.length} hint="today through next 6 days" onClick={() => onOpenTasks('due-week')} />
          <Metric icon="pause" label="Waiting" count={review.waiting.length} hint="blocked or pending" onClick={() => onOpenTasks('waiting')} />
        </div>

        <div className="review-grid">
          <section className="review-card review-attention" aria-labelledby="review-attention-title">
            <div className="review-card-heading"><div><span className="review-card-kicker">Decide what needs you</span><h3 id="review-attention-title">Needs attention</h3></div><Icon name="alert" /></div>
            {review.overdue.length > 0 && <ReviewTaskSection title="Overdue" tasks={review.overdue.slice(0, 4)} today={review.today} tone="warm" />}
            {review.dueSoon.length > 0 && <ReviewTaskSection title="Due in the next 7 days" tasks={review.dueSoon.slice(0, 4)} today={review.today} />}
            {review.overdue.length === 0 && review.dueSoon.length === 0 && <p className="review-empty-copy">No deadlines are pressing this week. You can use My Day to choose a small, realistic focus.</p>}
            <button className="review-text-action" type="button" onClick={() => onOpenTasks('all')}>Review your tasks <Icon name="arrow" /></button>
          </section>

          <section className="review-card" aria-labelledby="review-progress-title">
            <div className="review-card-heading"><div><span className="review-card-kicker">Recorded activity</span><h3 id="review-progress-title">Recent completions</h3></div><Icon name="check" /></div>
            <p className="review-progress-summary"><strong>{review.completedThisWeek}</strong> {plural(review.completedThisWeek, 'task')} completed so far this week</p>
            <div className="review-week-bars" role="list" aria-label="Completed tasks in the last four full weeks">
              {review.completedWeeks.map((week) => (
                <div className="review-week-bar" role="listitem" key={week.start} aria-label={`${week.label}: ${week.count} completed`}>
                  <div className="review-week-bar-track"><span style={{ height: `${Math.max(week.count ? 8 : 0, week.count / maxWeeklyCount * 100)}%` }} /></div>
                  <strong>{week.count}</strong><span>{week.label}</span>
                </div>
              ))}
            </div>
            <p className="review-fine-print">Counts describe tasks marked complete, not effort or progress quality.</p>
          </section>

          <section className="review-card" aria-labelledby="review-unplanned-title">
            <div className="review-card-heading"><div><span className="review-card-kicker">Make room before the deadline</span><h3 id="review-unplanned-title">Due soon, not planned</h3></div><Icon name="clock" /></div>
            {review.unplannedDueSoon.length > 0 ? (
              <ReviewTaskList tasks={review.unplannedDueSoon.slice(0, 5)} today={review.today} />
            ) : <p className="review-empty-copy">Every task due this week already has a planned day, or there are no near-term deadlines.</p>}
            {review.unplannedDueSoon.length > 0 && <button className="review-text-action" type="button" onClick={() => onOpenTasks('due-week')}>Plan upcoming tasks <Icon name="arrow" /></button>}
          </section>

          <section className="review-card" aria-labelledby="review-projects-title">
            <div className="review-card-heading"><div><span className="review-card-kicker">Work in motion</span><h3 id="review-projects-title">Projects to check</h3></div><Icon name="projects" /></div>
            {review.projects.length > 0 ? (
              <div className="review-project-list">
                {review.projects.slice(0, 5).map(({ project, areaName, openCount, waitingCount, dueSoonCount }) => (
                  <div className="review-project-row" key={project.id}>
                    <span className="review-project-mark"><Icon name="projects" /></span>
                    <div className="review-project-copy"><strong>{project.name}</strong><span>{areaName ? `${areaName} · ` : ''}{openCount} open {plural(openCount, 'task')}</span></div>
                    <div className="review-project-counts">
                      {waitingCount > 0 && <span className="review-waiting-count" title="Waiting tasks">{waitingCount} waiting</span>}
                      {dueSoonCount > 0 && <span>{dueSoonCount} due</span>}
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="review-empty-copy">Projects with open tasks will appear here. Keep unassigned work in Tasks or create a project when a group of tasks belongs together.</p>}
            <button className="review-text-action" type="button" onClick={onOpenProjects}>Open Projects <Icon name="arrow" /></button>
          </section>

          <section className="review-card review-inbox-card" aria-labelledby="review-inbox-title">
            <div className="review-card-heading"><div><span className="review-card-kicker">Capture before organizing</span><h3 id="review-inbox-title">Inbox to sort</h3></div><Icon name="inbox" /></div>
            {review.inbox.length > 0 ? (
              <ul className="review-inbox-list">
                {review.inbox.slice(0, 4).map((item) => <li key={item.id}><span>{item.text}</span><time dateTime={item.createdAt}>{formatInboxDate(item.createdAt)}</time></li>)}
              </ul>
            ) : <p className="review-empty-copy">Your Inbox is clear. Save ideas as they come up, then sort them when you’re ready.</p>}
            <div className="review-inbox-actions">
              <button className="review-text-action" type="button" onClick={() => onOpenTasks('inbox')}>Sort Inbox <Icon name="arrow" /></button>
              <button className="ghost-button" type="button" onClick={onQuickCapture}><Icon name="plus" /> Capture</button>
            </div>
          </section>

          <aside className="review-coach-card">
            <span className="review-coach-icon"><Icon name="sparkles" /></span>
            <div><span className="review-card-kicker">A moment for yourself</span><h3>What would make this week feel manageable?</h3><p>This review stays on your device. Nothing is shared with AI from this screen.</p></div>
            <button className="ghost-button" type="button" onClick={() => onOpenAssistant('Help me make this week feel manageable. Ask me one question if you need context, then suggest one realistic next step.')}>Open your Coach <Icon name="arrow" /></button>
          </aside>
        </div>
      </div>
    </section>
  )
}

function Metric({ icon, label, count, hint, tone, onClick }: {
  icon: 'inbox' | 'alert' | 'calendar' | 'pause'
  label: string
  count: number
  hint: string
  tone?: 'warm'
  onClick: () => void
}): React.JSX.Element {
  return <button className={`review-metric ${tone ? 'review-metric-warm' : ''}`} type="button" onClick={onClick}>
    <span className="review-metric-icon"><Icon name={icon} /></span><span className="review-metric-label">{label}</span><strong>{count}</strong><span className="review-metric-hint">{hint}</span>
  </button>
}

function ReviewTaskSection({ title, tasks, today, tone }: { title: string; tasks: ReviewViewModel['overdue']; today: string; tone?: 'warm' }): React.JSX.Element {
  return <div className={`review-task-section ${tone ? 'review-task-section-warm' : ''}`}><h4>{title}<span>{tasks.length}</span></h4><ReviewTaskList tasks={tasks} today={today} /></div>
}

function ReviewTaskList({ tasks, today }: { tasks: ReviewViewModel['dueSoon']; today: string }): React.JSX.Element {
  return <ul className="review-task-list">{tasks.map((task) => <li key={task.id}>
    <span className={`review-priority review-priority-${task.priority}`} aria-label={`${task.priority} priority`} />
    <div><strong>{task.title}</strong><span>{task.dueDate === today ? 'Due today' : `Due ${formatDate(task.dueDate!)}`}{task.projectId ? ` · ${task.workflowStage === 'waiting' ? 'Waiting' : 'Open'}` : ''}</span></div>
    <span className="review-task-priority">{task.priority}</span>
  </li>)}</ul>
}

function formatDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year!, month! - 1, day!)))
}

function formatRange(start: string, end: string): string {
  return `${formatDate(start)} – ${formatDate(end)}`
}

function formatInboxDate(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date) : 'Recently'
}

function getLocalDate(): string {
  const date = new Date()
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`
}
