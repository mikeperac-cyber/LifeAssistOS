import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CalendarEvent, JournalEntry, LifeGoal, PersonalContext, PlanTask, RoutineTemplate, TaskArea, TaskProject } from '../../../shared/types'
import { parseCalendarIcs } from '../../../shared/calendar-ics'
import { Icon } from './Icon'

type LifeTab = 'overview' | 'goals' | 'routines' | 'journal' | 'calendar' | 'context'
const TABS: Array<{ id: LifeTab; label: string }> = [
  { id: 'overview', label: 'Overview' }, { id: 'goals', label: 'Goals' }, { id: 'routines', label: 'Routines' }, { id: 'journal', label: 'Notes & journal' }, { id: 'calendar', label: 'Calendar' }, { id: 'context', label: 'AI context' }
]

export function LifeView({ refreshVersion, onOpenTasks }: { refreshVersion: number; onOpenTasks: () => void }): React.JSX.Element {
  const [tab, setTab] = useState<LifeTab>('overview')
  const [goals, setGoals] = useState<LifeGoal[]>([])
  const [areas, setAreas] = useState<TaskArea[]>([])
  const [projects, setProjects] = useState<TaskProject[]>([])
  const [tasks, setTasks] = useState<PlanTask[]>([])
  const [routines, setRoutines] = useState<RoutineTemplate[]>([])
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [context, setContext] = useState<PersonalContext>({ aboutMe: '', preferences: '', currentFocus: '', updatedAt: '' })
  const [sources, setSources] = useState<Array<{ id: string; name: string; importedAt: string; eventCount: number }>>([])
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [todayEvents, setTodayEvents] = useState<CalendarEvent[]>([])
  const [calendarDate, setCalendarDate] = useState(getLocalDate())
  const [query, setQuery] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [goalDraft, setGoalDraft] = useState<Partial<LifeGoal> | null>(null)
  const [routineDraft, setRoutineDraft] = useState<Partial<RoutineTemplate> | null>(null)
  const [journalDraft, setJournalDraft] = useState<Partial<JournalEntry> | null>(null)
  const [importSourceId, setImportSourceId] = useState('')
  const [importName, setImportName] = useState('')

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true); setError('')
    try {
      const [workspace, nextRoutines, nextEntries, nextContext, nextSources, nextEvents, nextTodayEvents] = await Promise.all([
        window.assist.getLifeWorkspace(), window.assist.getRoutineTemplates(), window.assist.getJournalEntries(searchQuery),
        window.assist.getPersonalContext(), window.assist.getCalendarSources(), window.assist.getCalendarEvents(calendarDate, calendarDate), window.assist.getCalendarEvents(getLocalDate(), getLocalDate())
      ])
      setGoals(workspace.goals); setAreas(workspace.areas); setProjects(workspace.projects); setTasks(workspace.tasks)
      setRoutines(nextRoutines); setEntries(nextEntries); setContext(nextContext); setSources(nextSources); setEvents(nextEvents); setTodayEvents(nextTodayEvents)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Your Life workspace could not be loaded.') }
    finally { setLoading(false) }
  }, [calendarDate, searchQuery])

  useEffect(() => { void refresh() }, [refresh, refreshVersion])
  useEffect(() => {
    const handleFocus = (): void => { void refresh() }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [refresh])
  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(query.trim()), 220)
    return () => window.clearTimeout(timer)
  }, [query])

  const saveGoal = async (): Promise<void> => {
    if (!goalDraft) return
    const result = await window.assist.saveLifeGoal({ id: goalDraft.id, title: goalDraft.title ?? '', description: goalDraft.description ?? '', areaId: goalDraft.areaId ?? null, status: goalDraft.status ?? 'active', targetDate: goalDraft.targetDate ?? null })
    if (!result.ok) throw new Error(result.error ?? 'Could not save the goal.')
    setGoalDraft(null); await refresh()
  }

  const deleteGoal = async (goal: LifeGoal): Promise<void> => {
    if (!window.confirm(`Delete “${goal.title}”? Linked projects and notes will stay and become unlinked.`)) return
    const result = await window.assist.deleteLifeGoal(goal.id)
    if (!result.ok) throw new Error(result.error ?? 'Could not delete the goal.')
    await refresh()
  }

  const saveRoutine = async (): Promise<void> => {
    if (!routineDraft) return
    const subtasks = (routineDraft.subtasks ?? []).map((item) => ({ title: item.title, notes: item.notes }))
    const result = await window.assist.saveRoutineTemplate({
      id: routineDraft.id, name: routineDraft.name ?? '', description: routineDraft.description ?? '', areaId: routineDraft.areaId ?? null,
      projectId: routineDraft.projectId ?? null, title: routineDraft.title ?? '', notes: routineDraft.notes ?? '', priority: routineDraft.priority ?? 'normal',
      subtasks, recurrenceRule: routineDraft.recurrenceRule ?? null
    })
    if (!result.ok) throw new Error(result.error ?? 'Could not save the routine.')
    setRoutineDraft(null); await refresh()
  }

  const applyRoutine = async (routine: RoutineTemplate): Promise<void> => {
    const result = await window.assist.applyRoutineTemplate(routine.id, getLocalDate())
    if (!result.ok) throw new Error(result.error ?? 'Could not add the routine to My Day.')
    setNotice(`${routine.name} added to My Day.`); window.setTimeout(() => setNotice(''), 3000); await refresh()
  }

  const addStarterRoutines = async (): Promise<void> => {
    const starters = [
      { name: 'Weekly reset', description: 'Clear space and choose a focus for the week.', title: 'Review the week ahead', subtasks: ['Clear the Inbox', 'Check upcoming dates', 'Choose this week’s top three'], recurrenceRule: { frequency: 'weekly' as const, weekdays: [0] } },
      { name: 'Home reset', description: 'A small reset that makes home feel easier.', title: 'Reset one shared space', subtasks: ['Put away items', 'Wipe one surface', 'Note anything to restock'] },
      { name: 'Bills & renewals', description: 'Keep recurring life admin from becoming urgent.', title: 'Review bills and renewals', subtasks: ['Check due dates', 'Confirm upcoming payments', 'File receipts or confirmations'] },
      { name: 'Focused study', description: 'Start with one clear learning outcome.', title: 'Complete a focused study session', subtasks: ['Choose one topic', 'Study for 25 minutes', 'Write a one-sentence takeaway'] },
      { name: 'Appointment prep', description: 'Arrive with the details and questions you need.', title: 'Prepare for an appointment', subtasks: ['Confirm time and location', 'Gather documents or notes', 'Write questions to ask'] }
    ]
    for (const starter of starters) {
      const result = await window.assist.saveRoutineTemplate({ ...starter, subtasks: starter.subtasks.map((title) => ({ title, notes: '' })), areaId: null, projectId: null, priority: 'normal' })
      if (!result.ok) throw new Error(result.error ?? `Could not add ${starter.name}.`)
    }
    setNotice('Five starter routines added. Edit or remove any of them.'); window.setTimeout(() => setNotice(''), 3500); await refresh()
  }

  const saveJournal = async (): Promise<void> => {
    if (!journalDraft) return
    const result = await window.assist.saveJournalEntry({ id: journalDraft.id, entryDate: journalDraft.entryDate ?? getLocalDate(), title: journalDraft.title ?? '', content: journalDraft.content ?? '', areaId: journalDraft.areaId ?? null, goalId: journalDraft.goalId ?? null })
    if (!result.ok) throw new Error(result.error ?? 'Could not save this note.')
    setJournalDraft(null); await refresh()
  }

  const saveContext = async (): Promise<void> => {
    setError(''); setNotice('')
    try { setContext(await window.assist.savePersonalContext(context)); setNotice('AI context saved on this device.') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save AI context.') }
  }

  const importCalendarFile = async (file?: File): Promise<void> => {
    if (!file) return
    setError(''); setNotice('')
    try {
      const parsed = parseCalendarIcs(await file.text())
      if (parsed.length === 0) throw new Error('No readable events were found in this calendar file.')
      const result = await window.assist.importCalendar(importSourceId || null, importName.trim() || file.name.replace(/\.ics$/i, ''), parsed)
      if (!result.ok) throw new Error(result.error ?? 'Could not import this calendar.')
      setNotice(`${parsed.length} calendar events imported locally.`); setImportName(''); setImportSourceId('')
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not read this calendar file.') }
  }

  const scheduledTasks = useMemo(() => tasks.filter((task) => task.status === 'open' && task.scheduledStart?.slice(0, 10) === calendarDate).sort((a, b) => (a.scheduledStart ?? '').localeCompare(b.scheduledStart ?? '')), [calendarDate, tasks])
  const selectedLabel = TABS.find((item) => item.id === tab)?.label ?? 'Overview'

  return <section className="life-view" aria-label="Life workspace" aria-busy={loading}>
    <header className="life-header">
      <div><span className="life-kicker"><Icon name="leaf" /> Your life, in one place</span><h2>Make room for what matters.</h2><p>Connect goals, plans, routines, and notes without losing control of your data.</p></div>
      <button className="primary-button" type="button" onClick={onOpenTasks}><Icon name="calendar" />Open My Day</button>
    </header>

    <nav className="life-tabs" aria-label="Life workspace sections" role="tablist">
      {TABS.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.label}</button>)}
    </nav>

    {notice && <p className="life-notice" role="status">{notice}</p>}
    {error && <div className="life-error" role="alert"><span>{error}</span><button className="ghost-button" type="button" onClick={() => void refresh()}>Retry</button></div>}
    {loading && goals.length === 0 && <p className="life-loading" role="status">Opening your Life workspace…</p>}

    {!loading && tab === 'overview' && <LifeOverviewTab goals={goals} routines={routines} entries={entries} tasks={tasks} projects={projects} todayEvents={todayEvents} onOpenTasks={onOpenTasks} onGoals={() => setTab('goals')} onRoutines={() => setTab('routines')} onJournal={() => setTab('journal')} onCalendar={() => setTab('calendar')} onNewGoal={() => { setTab('goals'); setGoalDraft({ status: 'active', areaId: null, targetDate: null }) }} onNewJournal={() => { setTab('journal'); setJournalDraft({ entryDate: getLocalDate(), title: '', content: '', areaId: null, goalId: null }) }} onApplyRoutine={(routine) => void applyRoutine(routine).catch(showError)} />}
    {!loading && tab === 'goals' && <GoalsTab goals={goals} areas={areas} projects={projects} tasks={tasks} onNew={() => setGoalDraft({ status: 'active', areaId: null, targetDate: null })} onEdit={setGoalDraft} onDelete={(goal) => void deleteGoal(goal).catch(showError)} />}
    {!loading && tab === 'routines' && <RoutinesTab routines={routines} areas={areas} projects={projects} onNew={() => setRoutineDraft({ priority: 'normal', areaId: null, projectId: null, subtasks: [], recurrenceRule: null })} onEdit={setRoutineDraft} onApply={(routine) => void applyRoutine(routine).catch(showError)} onAddStarters={() => void addStarterRoutines().catch(showError)} onDelete={(routine) => void (async () => { const result = await window.assist.deleteRoutineTemplate(routine.id); if (!result.ok) throw new Error(result.error ?? 'Could not delete the routine.'); await refresh() })().catch(showError)} />}
    {!loading && tab === 'journal' && <JournalTab entries={entries} goals={goals} areas={areas} query={query} onQuery={setQuery} onNew={() => setJournalDraft({ entryDate: getLocalDate(), title: '', content: '', areaId: null, goalId: null })} onEdit={setJournalDraft} onDelete={async (entry) => { const result = await window.assist.deleteJournalEntry(entry.id); if (!result.ok) throw new Error(result.error ?? 'Could not delete the note.'); await refresh() }} />}
    {!loading && tab === 'calendar' && <CalendarTab date={calendarDate} onDate={setCalendarDate} events={events} tasks={scheduledTasks} sources={sources} sourceId={importSourceId} onSource={setImportSourceId} importName={importName} onImportName={setImportName} onImport={(file) => void importCalendarFile(file)} onDeleteSource={async (id) => { const result = await window.assist.deleteCalendarSource(id); if (!result.ok) throw new Error(result.error ?? 'Could not remove that calendar.'); await refresh() }} />}
    {!loading && tab === 'context' && <ContextTab value={context} onChange={setContext} onSave={() => void saveContext()} />}

    {goalDraft && <GoalEditor value={goalDraft} areas={areas} onChange={setGoalDraft} onSave={() => void saveGoal().catch(showError)} onClose={() => setGoalDraft(null)} />}
    {routineDraft && <RoutineEditor value={routineDraft} areas={areas} projects={projects} onChange={setRoutineDraft} onSave={() => void saveRoutine().catch(showError)} onClose={() => setRoutineDraft(null)} />}
    {journalDraft && <JournalEditor value={journalDraft} areas={areas} goals={goals} onChange={setJournalDraft} onSave={() => void saveJournal().catch(showError)} onClose={() => setJournalDraft(null)} />}
    <p className="life-local-note">{selectedLabel} stay on this device and are included in your local backup.</p>
  </section>

  function showError(cause: unknown): void { setError(cause instanceof Error ? cause.message : 'That action could not be completed.') }
}

function LifeOverviewTab({ goals, routines, entries, tasks, projects, todayEvents, onOpenTasks, onGoals, onRoutines, onJournal, onCalendar, onNewGoal, onNewJournal, onApplyRoutine }: {
  goals: LifeGoal[]; routines: RoutineTemplate[]; entries: JournalEntry[]; tasks: PlanTask[]; projects: TaskProject[]; todayEvents: CalendarEvent[]
  onOpenTasks: () => void; onGoals: () => void; onRoutines: () => void; onJournal: () => void; onCalendar: () => void; onNewGoal: () => void; onNewJournal: () => void; onApplyRoutine: (routine: RoutineTemplate) => void
}): React.JSX.Element {
  const today = getLocalDate()
  const plannedTasks = tasks.filter((task) => task.status === 'open' && task.plannedDate === today)
  const doneToday = tasks.filter((task) => task.status === 'done' && task.completedAt?.slice(0, 10) === today).length
  const timeline = [
    ...todayEvents.map((event) => ({ key: `event-${event.id}`, time: event.startsAt, label: event.title, detail: event.location, allDay: event.allDay, type: 'event' as const })),
    ...plannedTasks.filter((task) => task.scheduledStart).map((task) => ({ key: `task-${task.id}`, time: task.scheduledStart!, label: task.title, detail: `${task.durationMinutes ?? 30} min planned`, allDay: false, type: 'task' as const }))
  ].sort((a, b) => a.time.localeCompare(b.time))
  const activeGoals = goals.filter((goal) => goal.status === 'active').slice(0, 3)
  const recentEntry = entries[0]
  return <div className="life-overview">
    <section className="life-overview-day">
      <div><span className="life-kicker"><Icon name="calendar" />{formatLongDate(today)}</span><h3>Keep today connected to the bigger picture.</h3><p>{plannedTasks.length} planned task{plannedTasks.length === 1 ? '' : 's'} · {todayEvents.length} calendar event{todayEvents.length === 1 ? '' : 's'} · {doneToday} completed</p></div>
      <button type="button" className="primary-button" onClick={onOpenTasks}>Open My Day</button>
    </section>
    <div className="life-overview-grid">
      <section className="life-overview-card life-overview-agenda">
        <div className="life-overview-card-head"><div><span>PLAN</span><h3>Today at a glance</h3></div><button type="button" className="todo-row-action" onClick={onCalendar}>Calendar</button></div>
        {timeline.length ? <div className="life-overview-agenda-list">{timeline.map((item) => <div key={item.key} className={`life-overview-agenda-item ${item.type}`}><time>{item.allDay ? 'All day' : formatTime(item.time)}</time><span><strong>{item.label}</strong>{item.detail && <small>{item.detail}</small>}</span><em>{item.type === 'event' ? 'Event' : 'Task'}</em></div>)}</div> : <div className="life-overview-empty"><p>No calendar events or scheduled tasks today.</p><button type="button" onClick={onCalendar}>Add calendar context</button><button type="button" onClick={onOpenTasks}>Plan a task</button></div>}
        {plannedTasks.length > 0 && <p className="life-overview-more">{plannedTasks.length} task{plannedTasks.length === 1 ? '' : 's'} planned for My Day</p>}
      </section>

      <section className="life-overview-card">
        <div className="life-overview-card-head"><div><span>DIRECTION</span><h3>Goals in motion</h3></div><button type="button" className="todo-row-action" onClick={onGoals}>All goals</button></div>
        {activeGoals.length ? <div className="life-overview-goals">{activeGoals.map((goal) => {
          const goalProjects = projects.filter((project) => project.goalId === goal.id)
          const goalTasks = tasks.filter((task) => goalProjects.some((project) => project.id === task.projectId))
          const complete = goalTasks.filter((task) => task.status === 'done').length
          const percent = goalTasks.length ? Math.round(complete / goalTasks.length * 100) : 0
          return <article key={goal.id}><div><strong>{goal.title}</strong><small>{goalProjects.length} projects · {complete}/{goalTasks.length} tasks done</small></div><span className="life-overview-progress"><i style={{ width: `${percent}%` }} /></span></article>
        })}</div> : <div className="life-overview-empty"><p>Give a priority a place to grow.</p><button type="button" onClick={onNewGoal}>Create a goal</button></div>}
      </section>

      <section className="life-overview-card">
        <div className="life-overview-card-head"><div><span>REPEAT</span><h3>Ready-to-use routines</h3></div><button type="button" className="todo-row-action" onClick={onRoutines}>All routines</button></div>
        {routines.length ? <div className="life-overview-routines">{routines.slice(0, 3).map((routine) => <article key={routine.id}><span><strong>{routine.name}</strong><small>{routine.subtasks.length} checklist items</small></span><button type="button" className="ghost-button" onClick={() => onApplyRoutine(routine)}>Add to My Day</button></article>)}</div> : <div className="life-overview-empty"><p>Save a checklist once, then add it whenever it fits.</p><button type="button" onClick={onRoutines}>Create a routine</button></div>}
      </section>

      <section className="life-overview-card life-overview-journal">
        <div className="life-overview-card-head"><div><span>REFLECT</span><h3>Recent note</h3></div><button type="button" className="todo-row-action" onClick={onNewJournal}>Write a note</button></div>
        {recentEntry ? <button type="button" className="life-overview-note" onClick={onJournal}><time>{formatDate(recentEntry.entryDate)}</time><strong>{recentEntry.title || 'Untitled note'}</strong><p>{recentEntry.content.slice(0, 240)}{recentEntry.content.length > 240 ? '…' : ''}</p></button> : <div className="life-overview-empty"><p>Keep a decision, reflection, or idea close to your goals.</p><button type="button" onClick={onNewJournal}>Write your first note</button></div>}
      </section>
    </div>
  </div>
}

function GoalsTab({ goals, areas, projects, tasks, onNew, onEdit, onDelete }: { goals: LifeGoal[]; areas: TaskArea[]; projects: TaskProject[]; tasks: PlanTask[]; onNew: () => void; onEdit: (goal: LifeGoal) => void; onDelete: (goal: LifeGoal) => void }): React.JSX.Element {
  return <div className="life-panel">
    <div className="life-panel-heading"><div><h3>Goals with a next step</h3><p>Link projects to a goal, then let their tasks make progress visible.</p></div><button className="primary-button" type="button" onClick={onNew}><Icon name="plus" />New goal</button></div>
    {goals.length ? <div className="life-goal-grid">{goals.map((goal) => {
      const linkedProjects = projects.filter((project) => project.goalId === goal.id)
      const linkedTasks = tasks.filter((task) => linkedProjects.some((project) => project.id === task.projectId))
      const completed = linkedTasks.filter((task) => task.status === 'done').length
      const active = linkedTasks.filter((task) => task.status === 'open').length
      const progress = linkedTasks.length ? Math.round(completed / linkedTasks.length * 100) : 0
      return <article className="life-goal-card" key={goal.id}>
        <div className="life-goal-top"><span className={`life-goal-status status-${goal.status}`}>{goal.status === 'done' ? 'Complete' : goal.status === 'paused' ? 'Paused' : 'In progress'}</span><span>{areas.find((area) => area.id === goal.areaId)?.name ?? 'Personal'}</span></div>
        <h4>{goal.title}</h4><p>{goal.description || 'A clear direction for the work and routines that matter.'}</p>
        <div className="life-goal-progress"><span><i style={{ width: `${progress}%` }} /></span><small>{completed} done · {active} open</small></div>
        <div className="life-goal-foot"><span>{linkedProjects.length} {linkedProjects.length === 1 ? 'project' : 'projects'}{goal.targetDate ? ` · target ${formatDate(goal.targetDate)}` : ''}</span><span><button type="button" className="todo-row-action" onClick={() => onEdit(goal)}>Edit</button><button type="button" className="todo-row-action" onClick={() => onDelete(goal)}>Delete</button></span></div>
      </article>
    })}</div> : <LifeEmpty title="Give a priority a place to grow" body="Create one goal, assign an Area, then link projects to turn it into steady progress." action="Create your first goal" onAction={onNew} />}
  </div>
}

function RoutinesTab({ routines, areas, projects, onNew, onEdit, onApply, onAddStarters, onDelete }: { routines: RoutineTemplate[]; areas: TaskArea[]; projects: TaskProject[]; onNew: () => void; onEdit: (routine: RoutineTemplate) => void; onApply: (routine: RoutineTemplate) => void; onAddStarters: () => void; onDelete: (routine: RoutineTemplate) => void }): React.JSX.Element {
  return <div className="life-panel">
    <div className="life-panel-heading"><div><h3>Routines that lighten the week</h3><p>Save a short checklist once. Add the next occurrence to My Day whenever it fits.</p></div><button className="primary-button" type="button" onClick={onNew}><Icon name="plus" />New routine</button></div>
    {routines.length ? <div className="life-routine-list">{routines.map((routine) => <article className="life-routine-card" key={routine.id}>
      <span className="life-routine-mark"><Icon name={routine.areaId && areas.find((area) => area.id === routine.areaId)?.icon === 'home' ? 'home' : routine.areaId && areas.find((area) => area.id === routine.areaId)?.icon === 'book' ? 'book' : 'check'} /></span>
      <div className="life-routine-copy"><h4>{routine.name}</h4><p>{routine.description || routine.title}</p><small>{areas.find((area) => area.id === routine.areaId)?.name ?? 'Personal'}{routine.projectId ? ` · ${projects.find((project) => project.id === routine.projectId)?.name ?? 'Project'}` : ''} · {routine.subtasks.length} checklist items</small></div>
      <button className="ghost-button" type="button" onClick={() => onApply(routine)}>Add to My Day</button><button className="todo-row-action" type="button" onClick={() => onEdit(routine)}>Edit</button><button className="todo-row-action" type="button" onClick={() => void onDelete(routine)}>Delete</button>
    </article>)}</div> : <LifeEmpty title="Build a repeatable reset" body="Start with a home reset, bill review, study session, or your own checklist." action="Add five starter routines" onAction={onAddStarters} />}
  </div>
}

function JournalTab({ entries, goals, areas, query, onQuery, onNew, onEdit, onDelete }: { entries: JournalEntry[]; goals: LifeGoal[]; areas: TaskArea[]; query: string; onQuery: (query: string) => void; onNew: () => void; onEdit: (entry: JournalEntry) => void; onDelete: (entry: JournalEntry) => Promise<void> }): React.JSX.Element {
  return <div className="life-panel">
    <div className="life-panel-heading"><div><h3>Notes that remember the why</h3><p>Keep decisions, reflections, and working notes close to the goals they support.</p></div><button className="primary-button" type="button" onClick={onNew}><Icon name="plus" />New note</button></div>
    <label className="life-search"><Icon name="search" /><span className="sr-only">Search notes</span><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search notes and reflections" /></label>
    {entries.length ? <div className="life-journal-list">{entries.map((entry) => <article className="life-journal-card" key={entry.id}>
      <div className="life-journal-date">{formatDate(entry.entryDate)}</div><div className="life-journal-copy"><h4>{entry.title || 'Untitled note'}</h4><p>{entry.content}</p><small>{areas.find((area) => area.id === entry.areaId)?.name ?? 'Personal'}{entry.goalId ? ` · ${goals.find((goal) => goal.id === entry.goalId)?.title ?? 'Goal'}` : ''}</small></div>
      <button className="todo-row-action" type="button" onClick={() => onEdit(entry)}>Edit</button><button className="todo-row-action" type="button" onClick={() => void onDelete(entry)}>Delete</button>
    </article>)}</div> : <LifeEmpty title={query ? 'No notes match that search' : 'Start with a blank page'} body={query ? 'Try a different word or phrase.' : 'Keep a decision, a reflection, or the idea you do not want to lose.'} action={query ? undefined : 'Write a note'} onAction={onNew} />}
  </div>
}

function CalendarTab({ date, onDate, events, tasks, sources, sourceId, onSource, importName, onImportName, onImport, onDeleteSource }: { date: string; onDate: (date: string) => void; events: CalendarEvent[]; tasks: PlanTask[]; sources: Array<{ id: string; name: string; importedAt: string; eventCount: number }>; sourceId: string; onSource: (id: string) => void; importName: string; onImportName: (name: string) => void; onImport: (file?: File) => void; onDeleteSource: (id: string) => Promise<void> }): React.JSX.Element {
  const sorted = [...events.map((event) => ({ kind: 'event' as const, time: event.startsAt, event })), ...tasks.map((task) => ({ kind: 'task' as const, time: task.scheduledStart ?? '', task }))].sort((a, b) => a.time.localeCompare(b.time))
  return <div className="life-panel">
    <div className="life-panel-heading"><div><h3>A day with breathing room</h3><p>Imported calendar events are read-only. Task time blocks stay under your control.</p></div><label className="life-date-field"><span>Date</span><input type="date" value={date} onChange={(event) => onDate(event.target.value)} /></label></div>
    <div className="life-calendar-grid">
      <section className="life-agenda" aria-label={`Agenda for ${formatDate(date)}`}>
        <h4>{formatLongDate(date)}</h4>
        {!sorted.length ? <p className="life-empty-copy">Nothing on the calendar yet. Import an .ics file or schedule a task for this day.</p> : sorted.map((item) => item.kind === 'event'
          ? <article className="life-agenda-item is-event" key={`event-${item.event.id}`}><time>{item.event.allDay ? 'All day' : formatTime(item.event.startsAt)}</time><span><strong>{item.event.title}</strong>{item.event.location && <small>{item.event.location}</small>}</span><span className="life-agenda-kind">Calendar</span></article>
          : <article className="life-agenda-item is-task" key={`task-${item.task.id}`}><time>{formatLocalTime(item.task.scheduledStart)}</time><span><strong>{item.task.title}</strong><small>{item.task.durationMinutes ?? 30} min planned</small></span><span className="life-agenda-kind">Task</span></article>)}
      </section>
      <aside className="life-calendar-import">
        <h4>Read a calendar export</h4><p>Export an .ics file from Google Calendar or Outlook. Mike Assist stores the event details locally and does not edit the source calendar.</p>
        <label className="field"><span className="field-label">Replace calendar (optional)</span><select value={sourceId} onChange={(event) => onSource(event.target.value)}><option value="">Import as new calendar</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
        <label className="field"><span className="field-label">Calendar name</span><input value={importName} maxLength={120} placeholder="Personal calendar" onChange={(event) => onImportName(event.target.value)} /></label>
        <label className="life-file-button ghost-button"><Icon name="plus" />Choose .ics file<input type="file" accept=".ics,text/calendar" onChange={(event) => onImport(event.target.files?.[0])} /></label>
        <div className="life-source-list">{sources.map((source) => <div key={source.id}><span><strong>{source.name}</strong><small>{source.eventCount} events · imported {formatDate(source.importedAt.slice(0, 10))}</small></span><button type="button" className="todo-row-action" onClick={() => void onDeleteSource(source.id)}>Remove</button></div>)}</div>
      </aside>
    </div>
  </div>
}

function ContextTab({ value, onChange, onSave }: { value: PersonalContext; onChange: (value: PersonalContext) => void; onSave: () => void }): React.JSX.Element {
  return <div className="life-panel life-context-panel">
    <div className="life-panel-heading"><div><h3>What your AI should know about you</h3><p>Saved only on this device. It is sent only when you explicitly turn on personal context in a conversation.</p></div><button className="primary-button" type="button" onClick={onSave}>Save context</button></div>
    <div className="life-context-form">
      <label className="field"><span className="field-label">A little about me</span><textarea rows={3} maxLength={2000} value={value.aboutMe} onChange={(event) => onChange({ ...value, aboutMe: event.target.value })} placeholder="For example: I teach English and study in short sessions after work." /></label>
      <label className="field"><span className="field-label">How I like to work and learn</span><textarea rows={3} maxLength={2000} value={value.preferences} onChange={(event) => onChange({ ...value, preferences: event.target.value })} placeholder="For example: Keep plans realistic, explain new ideas with examples, and be concise." /></label>
      <label className="field"><span className="field-label">What I am focused on now</span><textarea rows={3} maxLength={2000} value={value.currentFocus} onChange={(event) => onChange({ ...value, currentFocus: event.target.value })} placeholder="A project, goal, or life change you want help keeping in view." /></label>
    </div>
    <p className="life-privacy-note">Your profile stays on this device. Nothing is attached to an AI request unless you enable the context toggle for that request.</p>
  </div>
}

function GoalEditor({ value, areas, onChange, onSave, onClose }: { value: Partial<LifeGoal>; areas: TaskArea[]; onChange: (value: Partial<LifeGoal>) => void; onSave: () => void; onClose: () => void }): React.JSX.Element {
  return <EditorShell title={value.id ? 'Edit goal' : 'New goal'} onClose={onClose} onSave={onSave}>
    <label className="field"><span className="field-label">Goal</span><input autoFocus maxLength={120} value={value.title ?? ''} onChange={(event) => onChange({ ...value, title: event.target.value })} placeholder="Build a steady study habit" /></label>
    <label className="field"><span className="field-label">Why it matters</span><textarea rows={3} maxLength={2000} value={value.description ?? ''} onChange={(event) => onChange({ ...value, description: event.target.value })} placeholder="Keep this concrete and personal." /></label>
    <div className="form-grid"><label className="field"><span className="field-label">Area</span><select value={value.areaId ?? ''} onChange={(event) => onChange({ ...value, areaId: event.target.value || null })}><option value="">Personal</option>{areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label><label className="field"><span className="field-label">Target date</span><input type="date" value={value.targetDate ?? ''} onChange={(event) => onChange({ ...value, targetDate: event.target.value || null })} /></label></div>
    <label className="field"><span className="field-label">Status</span><select value={value.status ?? 'active'} onChange={(event) => onChange({ ...value, status: event.target.value as LifeGoal['status'] })}><option value="active">In progress</option><option value="paused">Paused</option><option value="done">Complete</option></select></label>
  </EditorShell>
}

function RoutineEditor({ value, areas, projects, onChange, onSave, onClose }: { value: Partial<RoutineTemplate>; areas: TaskArea[]; projects: TaskProject[]; onChange: (value: Partial<RoutineTemplate>) => void; onSave: () => void; onClose: () => void }): React.JSX.Element {
  const rule = value.recurrenceRule
  return <EditorShell title={value.id ? 'Edit routine' : 'New routine'} onClose={onClose} onSave={onSave}>
    <label className="field"><span className="field-label">Routine name</span><input autoFocus maxLength={100} value={value.name ?? ''} onChange={(event) => onChange({ ...value, name: event.target.value })} placeholder="Weekly reset" /></label>
    <label className="field"><span className="field-label">What this routine helps with</span><input maxLength={1000} value={value.description ?? ''} onChange={(event) => onChange({ ...value, description: event.target.value })} placeholder="A quick review before the week begins" /></label>
    <label className="field"><span className="field-label">First task</span><input maxLength={240} value={value.title ?? ''} onChange={(event) => onChange({ ...value, title: event.target.value })} placeholder="Review the week ahead" /></label>
    <label className="field"><span className="field-label">Task notes</span><textarea rows={2} maxLength={2000} value={value.notes ?? ''} onChange={(event) => onChange({ ...value, notes: event.target.value })} /></label>
    <label className="field"><span className="field-label">Checklist items (one per line)</span><textarea rows={4} maxLength={3000} value={(value.subtasks ?? []).map((item) => item.title).join('\n')} onChange={(event) => onChange({ ...value, subtasks: event.target.value.split('\n').slice(0, 20).map((title) => ({ title: title.slice(0, 240), notes: '' })) })} placeholder={'Clear the Inbox\nReview upcoming deadlines\nChoose the week’s focus'} /></label>
    <div className="form-grid"><label className="field"><span className="field-label">Repeat</span><select value={rule?.frequency ?? 'none'} onChange={(event) => onChange({ ...value, recurrenceRule: event.target.value === 'none' ? null : event.target.value === 'daily' ? { frequency: 'daily' } : { frequency: 'weekly', weekdays: [1] } })}><option value="none">When I choose</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label><label className="field"><span className="field-label">Priority</span><select value={value.priority ?? 'normal'} onChange={(event) => onChange({ ...value, priority: event.target.value as RoutineTemplate['priority'] })}><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option></select></label></div>
    {rule?.frequency === 'weekly' && <div className="life-weekdays" aria-label="Repeat on weekdays">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, index) => <label key={day}><input type="checkbox" checked={rule.weekdays?.includes(index) ?? false} onChange={(event) => { const days = new Set(rule.weekdays ?? []); event.target.checked ? days.add(index) : days.delete(index); onChange({ ...value, recurrenceRule: { frequency: 'weekly', weekdays: [...days].sort() } }) }} />{day}</label>)}</div>}
    <div className="form-grid"><label className="field"><span className="field-label">Area</span><select value={value.areaId ?? ''} onChange={(event) => onChange({ ...value, areaId: event.target.value || null, projectId: null })}><option value="">Personal</option>{areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label><label className="field"><span className="field-label">Project</span><select value={value.projectId ?? ''} onChange={(event) => onChange({ ...value, projectId: event.target.value || null })}><option value="">No project</option>{projects.filter((project) => !value.areaId || project.areaId === value.areaId).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label></div>
  </EditorShell>
}

function JournalEditor({ value, areas, goals, onChange, onSave, onClose }: { value: Partial<JournalEntry>; areas: TaskArea[]; goals: LifeGoal[]; onChange: (value: Partial<JournalEntry>) => void; onSave: () => void; onClose: () => void }): React.JSX.Element {
  return <EditorShell title={value.id ? 'Edit note' : 'New note'} onClose={onClose} onSave={onSave}>
    <label className="field"><span className="field-label">Date</span><input type="date" value={value.entryDate ?? getLocalDate()} onChange={(event) => onChange({ ...value, entryDate: event.target.value })} /></label>
    <label className="field"><span className="field-label">Title</span><input autoFocus maxLength={160} value={value.title ?? ''} onChange={(event) => onChange({ ...value, title: event.target.value })} placeholder="A decision, idea, or reflection" /></label>
    <label className="field"><span className="field-label">Note</span><textarea rows={9} maxLength={20000} value={value.content ?? ''} onChange={(event) => onChange({ ...value, content: event.target.value })} placeholder="Write freely. Notes remain on this device." /></label>
    <div className="form-grid"><label className="field"><span className="field-label">Area</span><select value={value.areaId ?? ''} onChange={(event) => onChange({ ...value, areaId: event.target.value || null })}><option value="">Personal</option>{areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label><label className="field"><span className="field-label">Goal</span><select value={value.goalId ?? ''} onChange={(event) => onChange({ ...value, goalId: event.target.value || null })}><option value="">No goal</option>{goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select></label></div>
  </EditorShell>
}

function EditorShell({ title, children, onSave, onClose }: { title: string; children: React.ReactNode; onSave: () => void; onClose: () => void }): React.JSX.Element {
  return <div className="life-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="life-editor" role="dialog" aria-modal="true" aria-label={title}><header><h3>{title}</h3><button className="icon-button" type="button" aria-label="Close" onClick={onClose}>×</button></header><div className="life-editor-fields">{children}</div><footer><button className="ghost-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="button" onClick={onSave}>Save</button></footer></section></div>
}

function LifeEmpty({ title, body, action, onAction }: { title: string; body: string; action?: string; onAction: () => void }): React.JSX.Element {
  return <div className="life-empty-state"><span><Icon name="leaf" /></span><h4>{title}</h4><p>{body}</p>{action && <button className="ghost-button" type="button" onClick={onAction}>{action}</button>}</div>
}

function getLocalDate(): string {
  const date = new Date()
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}
function formatDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: year === new Date().getFullYear() ? undefined : 'numeric' })
}
function formatLongDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}
function formatTime(value: string): string { return new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) }
function formatLocalTime(value: string | null | undefined): string { return value ? new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : 'Unscheduled' }
