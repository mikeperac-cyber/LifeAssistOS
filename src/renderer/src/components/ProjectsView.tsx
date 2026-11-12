import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LifeGoal, PlanTask, TaskArea, TaskProject, TaskWorkflowStage } from '../../../shared/types'
import { TaskEditorDialog, type TaskEditorValues } from './TaskEditorDialog'
import { AccessibleDialog } from './AccessibleDialog'
import { Icon } from './Icon'

type ProjectLayout = 'list' | 'board'
type TaskEditorState = { kind: 'new' } | { kind: 'edit'; task: PlanTask }
const STAGES: Array<{ id: TaskWorkflowStage; label: string }> = [
  { id: 'next', label: 'Next' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'waiting', label: 'Waiting' }
]
const AREA_ICONS = ['briefcase', 'home', 'book', 'leaf'] as const
const AREA_COLORS = ['teal', 'blue', 'amber', 'violet'] as const

export function ProjectsView(): React.JSX.Element {
  const [areas, setAreas] = useState<TaskArea[]>([])
  const [goals, setGoals] = useState<LifeGoal[]>([])
  const [projects, setProjects] = useState<TaskProject[]>([])
  const [tasks, setTasks] = useState<PlanTask[]>([])
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [layout, setLayout] = useState<ProjectLayout>('board')
  const [query, setQuery] = useState('')
  const [areaFormOpen, setAreaFormOpen] = useState(false)
  const [areaName, setAreaName] = useState('')
  const [areaIcon, setAreaIcon] = useState<(typeof AREA_ICONS)[number]>('briefcase')
  const [areaColor, setAreaColor] = useState<(typeof AREA_COLORS)[number]>('teal')
  const [projectEditor, setProjectEditor] = useState<{ project?: TaskProject; areaId?: string | null } | null>(null)
  const [taskEditor, setTaskEditor] = useState<TaskEditorState | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const workspace = await window.assist.getLifeWorkspace()
      setAreas(workspace.areas)
      setGoals(workspace.goals)
      setProjects(workspace.projects)
      setTasks(workspace.tasks)
      setSelectedProjectId((current) => workspace.projects.some((project) => project.id === current) ? current : workspace.projects[0]?.id ?? null)
      setSelectedAreaId((current) => current === null || workspace.areas.some((area) => area.id === current) ? current : null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    const unsubscribe = window.assist.onEvent((event) => { if (event.type === 'today_changed') void refresh() })
    return unsubscribe
  }, [refresh])

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null
  const visibleProjects = useMemo(() => projects.filter((project) => selectedAreaId === null || project.areaId === selectedAreaId), [projects, selectedAreaId])
  const projectTasks = useMemo(() => tasks.filter((task) => task.projectId === selectedProjectId && matches(`${task.title} ${task.notes}`, query)), [query, selectedProjectId, tasks])
  const activeArea = selectedProject?.areaId ? areas.find((area) => area.id === selectedProject.areaId) : undefined

  async function createArea(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const result = await window.assist.createArea({ name: areaName, icon: areaIcon, color: areaColor })
    if (!result.ok || !result.area) { setError(result.error ?? 'Could not create this Area.'); return }
    setAreaName('')
    setAreaFormOpen(false)
    setSelectedAreaId(result.area.id)
    await refresh()
  }

  async function createOrUpdateProject(values: { name: string; description: string; targetDate: string | null; areaId: string | null; goalId: string | null }): Promise<void> {
    const result = projectEditor?.project
      ? await window.assist.updateProject(projectEditor.project.id, values)
      : await window.assist.createProject(values)
    if (!result.ok) throw new Error(result.error ?? 'Could not save this project.')
    const projectId = result.project?.id ?? projectEditor?.project?.id ?? null
    setProjectEditor(null)
    await refresh()
    if (projectId) setSelectedProjectId(projectId)
  }

  async function removeProject(): Promise<void> {
    if (!selectedProject || !window.confirm(`Delete “${selectedProject.name}”? Its tasks will be kept and moved to All Tasks.`)) return
    const result = await window.assist.deleteProject(selectedProject.id)
    if (!result.ok) { setError(result.error ?? 'Could not delete this project.'); return }
    setSelectedProjectId(null)
    await refresh()
  }

  async function removeArea(area: TaskArea): Promise<void> {
    if (!window.confirm(`Delete the “${area.name}” Area? Projects in it will be kept and become unassigned.`)) return
    const result = await window.assist.deleteArea(area.id)
    if (!result.ok) { setError(result.error ?? 'Could not delete this Area.'); return }
    if (selectedAreaId === area.id) setSelectedAreaId(null)
    await refresh()
  }

  async function saveTask(values: TaskEditorValues): Promise<void> {
    const result = taskEditor?.kind === 'edit'
      ? await window.assist.updatePlanTask(taskEditor.task.id, values)
      : await window.assist.addPlanTask({ ...values, projectId: selectedProjectId })
    if (!result.ok) throw new Error(result.error ?? 'Could not save this task.')
    setTaskEditor(null)
    await refresh()
  }

  async function updateTask(task: PlanTask, patch: Partial<Pick<PlanTask, 'status' | 'workflowStage' | 'projectId'>>): Promise<void> {
    const result = await window.assist.updatePlanTask(task.id, patch)
    if (!result.ok) { setError(result.error ?? 'Could not update this task.'); return }
    await refresh()
  }

  async function skipOccurrence(task: PlanTask): Promise<void> {
    const result = await window.assist.skipPlanTaskOccurrence(task.id)
    if (!result.ok) { setError(result.error ?? 'Could not skip this occurrence.'); return }
    await refresh()
  }

  async function planTaskForToday(task: PlanTask): Promise<void> {
    const date = getLocalDate()
    const result = await window.assist.planTaskForDay(task.id, task.plannedDate === date ? null : date)
    if (!result.ok) { setError(result.error ?? 'Could not update My Day.'); return }
    await refresh()
  }

  function selectArea(areaId: string | null): void {
    setSelectedAreaId(areaId)
    const first = projects.find((project) => areaId === null || project.areaId === areaId)
    setSelectedProjectId(first?.id ?? null)
  }

  const groupedProjects = areas.map((area) => ({ area, projects: visibleProjects.filter((project) => project.areaId === area.id) }))
  const unassignedProjects = visibleProjects.filter((project) => project.areaId === null)

  return (
    <section className="projects-view" aria-label="Projects workspace">
      <aside className="projects-rail" aria-label="Areas and projects">
        <div className="projects-rail-heading"><h2>Areas</h2><button className="icon-button" type="button" aria-label="Add Area" title="Add Area" onClick={() => setAreaFormOpen((open) => !open)}><Icon name="plus" /></button></div>
        <button type="button" className={`projects-area-all ${selectedAreaId === null ? 'active' : ''}`} onClick={() => selectArea(null)}>All projects<span>{projects.length}</span></button>
        {areaFormOpen && (
          <form className="projects-area-form" onSubmit={(event) => void createArea(event)}>
            <label><span className="sr-only">Area name</span><input value={areaName} maxLength={80} placeholder="Name an Area" onChange={(event) => setAreaName(event.target.value)} autoFocus /></label>
            <div className="projects-area-form-options">
              <label><span className="sr-only">Area icon</span><select value={areaIcon} onChange={(event) => setAreaIcon(event.target.value as typeof areaIcon)}>{AREA_ICONS.map((icon) => <option key={icon} value={icon}>{icon}</option>)}</select></label>
              <label><span className="sr-only">Area color</span><select value={areaColor} onChange={(event) => setAreaColor(event.target.value as typeof areaColor)}>{AREA_COLORS.map((color) => <option key={color} value={color}>{color}</option>)}</select></label>
              <button className="icon-button" type="submit" aria-label="Save Area"><Icon name="plus" /></button>
            </div>
          </form>
        )}
        <div className="projects-area-list">
          {groupedProjects.map(({ area, projects: areaProjects }) => (
            <section className="projects-area-group" key={area.id}>
              <div className="projects-area-row">
                <button type="button" className={`projects-area-select area-${area.color} ${selectedAreaId === area.id ? 'active' : ''}`} onClick={() => selectArea(area.id)}>
                  <Icon name={area.icon} /><span>{area.name}</span><span className="projects-area-count">{areaProjects.length}</span>
                </button>
                <button type="button" className="projects-area-delete" aria-label={`Delete ${area.name} Area`} title="Delete Area" onClick={() => void removeArea(area)}>×</button>
              </div>
              {areaProjects.map((project) => <ProjectNavItem key={project.id} project={project} active={project.id === selectedProjectId} onClick={() => { setSelectedAreaId(area.id); setSelectedProjectId(project.id) }} />)}
            </section>
          ))}
          {unassignedProjects.length > 0 && <section className="projects-area-group"><span className="projects-unassigned-label">Unassigned</span>{unassignedProjects.map((project) => <ProjectNavItem key={project.id} project={project} active={project.id === selectedProjectId} onClick={() => { setSelectedAreaId(null); setSelectedProjectId(project.id) }} />)}</section>}
        </div>
        <button type="button" className="projects-new-project" onClick={() => setProjectEditor({ areaId: selectedAreaId })}><Icon name="plus" />New project</button>
      </aside>

      <div className="projects-main">
        {error && <div className="todo-error" role="alert"><span>{error}</span><button className="ghost-button" type="button" onClick={() => void refresh()}>Retry</button></div>}
        {loading ? <p className="todo-empty" role="status">Loading projects…</p> : selectedProject ? (
          <>
            <header className="projects-header">
              <div className="projects-title-block">
                <div className="projects-breadcrumb">{activeArea ? <><Icon name={activeArea.icon} /><span>{activeArea.name}</span><Icon name="chevron" /></> : <span>Unassigned</span>}</div>
                <h2>{selectedProject.name}</h2>
                <p>{selectedProject.description || 'A place for the work that belongs together.'}</p>
                {selectedProject.targetDate && <span className="projects-target"><Icon name="flag" />Target · {formatDate(selectedProject.targetDate)}</span>}
              </div>
              <div className="projects-header-actions">
                <button className="ghost-button" type="button" onClick={() => setProjectEditor({ project: selectedProject })}>Edit project</button>
                <button className="icon-button projects-delete-button" type="button" aria-label="Delete project" title="Delete project" onClick={() => void removeProject()}>×</button>
              </div>
            </header>
            <div className="projects-toolbar">
              <div className="projects-layout-toggle" role="group" aria-label="Project layout">
                <button className={layout === 'list' ? 'active' : ''} type="button" aria-pressed={layout === 'list'} onClick={() => setLayout('list')}><Icon name="list" />List</button>
                <button className={layout === 'board' ? 'active' : ''} type="button" aria-pressed={layout === 'board'} onClick={() => setLayout('board')}><Icon name="board" />Board</button>
              </div>
              <label className="projects-search"><Icon name="search" /><span className="sr-only">Search this project</span><input value={query} placeholder="Search tasks" onChange={(event) => setQuery(event.target.value)} /></label>
              <button type="button" className="primary-button projects-add-task" onClick={() => setTaskEditor({ kind: 'new' })}><Icon name="plus" />New task</button>
            </div>
            {layout === 'board' ? (
              <div className="project-board" aria-label={`${selectedProject.name} board`}>
                {STAGES.map((stage) => {
                  const stageTasks = projectTasks.filter((task) => task.status === 'open' && (task.workflowStage ?? 'next') === stage.id)
                  return <section className="project-column" key={stage.id} aria-labelledby={`project-stage-${stage.id}`}>
                    <header><h3 id={`project-stage-${stage.id}`}><StageGlyph stage={stage.id} />{stage.label}</h3><span>{stageTasks.length}</span></header>
                    <div className="project-column-tasks">
                      {stageTasks.map((task) => <ProjectTaskCard key={task.id} task={task} onComplete={() => void updateTask(task, { status: 'done' })} onEdit={() => setTaskEditor({ kind: 'edit', task })} onMove={(workflowStage) => void updateTask(task, { workflowStage })} onSkip={() => void skipOccurrence(task)} />)}
                      <button type="button" className="project-column-add" onClick={() => { setTaskEditor({ kind: 'new' }); setQuery('') }}><Icon name="plus" />Add a task</button>
                    </div>
                  </section>
                })}
              </div>
            ) : (
              <div className="project-list" role="list" aria-label={`${selectedProject.name} tasks`}>
                {projectTasks.length === 0 ? <ProjectEmpty hasQuery={Boolean(query)} onAdd={() => setTaskEditor({ kind: 'new' })} /> : projectTasks.map((task) => <ProjectTaskLine key={task.id} task={task} onEdit={() => setTaskEditor({ kind: 'edit', task })} onComplete={() => void updateTask(task, { status: task.status === 'open' ? 'done' : 'open' })} onPlan={() => void planTaskForToday(task)} onMove={(workflowStage) => void updateTask(task, { workflowStage })} onSkip={() => void skipOccurrence(task)} />)}
                {projectTasks.some((task) => task.status === 'done') && <p className="projects-completed-note">Completed tasks remain here, in your project history.</p>}
              </div>
            )}
            {layout === 'board' && projectTasks.some((task) => task.status === 'done') && <details className="projects-completed"><summary>Completed · {projectTasks.filter((task) => task.status === 'done').length}</summary><div className="project-list">{projectTasks.filter((task) => task.status === 'done').map((task) => <ProjectTaskLine key={task.id} task={task} onEdit={() => setTaskEditor({ kind: 'edit', task })} onComplete={() => void updateTask(task, { status: 'open' })} onPlan={() => void planTaskForToday(task)} onMove={(workflowStage) => void updateTask(task, { workflowStage })} onSkip={() => void skipOccurrence(task)} />)}</div></details>}
            {layout === 'board' && projectTasks.some((task) => task.status === 'cancelled') && <details className="projects-completed"><summary>Archived · {projectTasks.filter((task) => task.status === 'cancelled').length}</summary><div className="project-list">{projectTasks.filter((task) => task.status === 'cancelled').map((task) => <ProjectTaskLine key={task.id} task={task} onEdit={() => setTaskEditor({ kind: 'edit', task })} onComplete={() => void updateTask(task, { status: 'open' })} onPlan={() => void planTaskForToday(task)} onMove={(workflowStage) => void updateTask(task, { workflowStage })} onSkip={() => void skipOccurrence(task)} />)}</div></details>}
          </>
        ) : (
          <div className="projects-empty-state"><span className="projects-empty-icon"><Icon name="projects" /></span><h2>{projects.length ? 'Choose a project' : 'Start with an Area or project'}</h2><p>Keep related work together, then move each task through a simple workflow.</p><div><button type="button" className="primary-button" onClick={() => setProjectEditor({ areaId: selectedAreaId })}><Icon name="plus" />New project</button>{!areas.length && <button type="button" className="ghost-button" onClick={() => setAreaFormOpen(true)}>Create an Area</button>}</div></div>
        )}
      </div>

      {taskEditor && <TaskEditorDialog key={taskEditor.kind === 'edit' ? taskEditor.task.id : `new-${selectedProjectId}`} task={taskEditor.kind === 'edit' ? taskEditor.task : undefined} projects={projects} initialProjectId={selectedProjectId} heading={taskEditor.kind === 'edit' ? 'Edit project task' : 'New project task'} onClose={() => setTaskEditor(null)} onSave={saveTask} />}
      {projectEditor && <ProjectEditorDialog project={projectEditor.project} areas={areas} goals={goals} initialAreaId={projectEditor.areaId ?? null} onClose={() => setProjectEditor(null)} onSave={createOrUpdateProject} />}
    </section>
  )
}

function ProjectNavItem({ project, active, onClick }: { project: TaskProject; active: boolean; onClick: () => void }): React.JSX.Element {
  return <button type="button" className={`projects-nav-item ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onClick}><span className="projects-nav-icon"><Icon name="list" /></span><span>{project.name}</span></button>
}

function ProjectTaskCard({ task, onComplete, onEdit, onMove, onSkip }: { task: PlanTask; onComplete: () => void; onEdit: () => void; onMove: (stage: TaskWorkflowStage) => void; onSkip: () => void }): React.JSX.Element {
  return <article className="project-task-card">
    <div className="project-task-title-row"><button className="todo-task-check" type="button" aria-label={`Complete ${task.title}`} onClick={onComplete} /><button type="button" className="project-task-title" onClick={onEdit}>{task.title}</button><button className="icon-button project-task-edit" type="button" aria-label={`Edit ${task.title}`} onClick={onEdit}>···</button></div>
    {task.notes && <p className="project-task-notes">{task.notes}</p>}
    <div className="project-task-meta">{task.priority !== 'normal' && <span className={`todo-task-priority priority-${task.priority}`}>{task.priority}</span>}{task.dueDate && <span className="todo-task-date"><Icon name="clock" />{formatDate(task.dueDate)}</span>}{task.recurrenceRule && <span className="todo-task-repeat">{formatRecurrence(task)}</span>}</div>
    {task.recurrenceRule && <button className="todo-row-action project-skip-action" type="button" onClick={onSkip} aria-label={`Skip this occurrence of ${task.title}`}>Skip once</button>}
    <label className="sr-only" htmlFor={`stage-${task.id}`}>Move {task.title} to stage</label><select id={`stage-${task.id}`} className="project-task-stage" value={task.workflowStage ?? 'next'} onChange={(event) => onMove(event.target.value as TaskWorkflowStage)}><option value="next">Move to Next</option><option value="in-progress">Move to In progress</option><option value="waiting">Move to Waiting</option></select>
  </article>
}

function ProjectTaskLine({ task, onEdit, onComplete, onPlan, onMove, onSkip }: { task: PlanTask; onEdit: () => void; onComplete: () => void; onPlan: () => void; onMove: (stage: TaskWorkflowStage) => void; onSkip: () => void }): React.JSX.Element {
  return <article className={`project-task-line ${task.status === 'done' ? 'is-complete' : ''} ${task.status === 'cancelled' ? 'is-archived' : ''}`} role="listitem">
    {task.status === 'open' ? <button type="button" className="todo-task-check" aria-label={`Complete ${task.title}`} onClick={onComplete} /> : task.status === 'done' ? <button type="button" className="todo-task-check checked" aria-label={`Reopen ${task.title}`} onClick={onComplete}>✓</button> : <span className="todo-task-check archived-check" aria-label={`Archived ${task.title}`}>–</span>}
    <div className="project-task-copy"><button type="button" className="project-task-title" onClick={onEdit}>{task.title}</button>{task.notes && <p>{task.notes}</p>}<div className="project-task-meta">{task.dueDate && <span className="todo-task-date"><Icon name="clock" />Due {formatDate(task.dueDate)}</span>}{task.priority !== 'normal' && <span className={`todo-task-priority priority-${task.priority}`}>{task.priority}</span>}{task.recurrenceRule && <span className="todo-task-repeat">{formatRecurrence(task)}</span>}</div></div>
    {task.status === 'open' && <><select className="project-list-stage" aria-label={`Stage for ${task.title}`} value={task.workflowStage ?? 'next'} onChange={(event) => onMove(event.target.value as TaskWorkflowStage)}><option value="next">Next</option><option value="in-progress">In progress</option><option value="waiting">Waiting</option></select><button className="todo-row-action" type="button" onClick={onPlan}>{task.plannedDate === getLocalDate() ? 'Remove from My Day' : '＋ My Day'}</button>{task.recurrenceRule && <button className="todo-row-action" type="button" onClick={onSkip} aria-label={`Skip this occurrence of ${task.title}`}>Skip once</button>}</>}
    {task.status === 'cancelled' && <button className="todo-row-action" type="button" onClick={onComplete}>Restore</button>}
    <button className="todo-row-action" type="button" onClick={onEdit}>Edit</button>
  </article>
}

function formatRecurrence(task: PlanTask): string {
  const rule = task.recurrenceRule!
  const label = rule.frequency === 'daily' ? 'Repeats daily' : rule.frequency === 'monthly' ? `Repeats monthly on day ${rule.monthDay}` : `Repeats ${rule.weekdays?.map((day) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day]).join(', ')}`
  return rule.endsOn ? `${label} · through ${formatDate(rule.endsOn)}` : label
}

function ProjectEmpty({ hasQuery, onAdd }: { hasQuery: boolean; onAdd: () => void }): React.JSX.Element {
  return <div className="projects-list-empty"><p>{hasQuery ? 'No tasks match this search.' : 'This project is ready for its first task.'}</p>{!hasQuery && <button className="ghost-button" type="button" onClick={onAdd}><Icon name="plus" />Add a task</button>}</div>
}

function ProjectEditorDialog({ project, areas, goals, initialAreaId, onClose, onSave }: { project?: TaskProject; areas: TaskArea[]; goals: LifeGoal[]; initialAreaId: string | null; onClose: () => void; onSave: (values: { name: string; description: string; targetDate: string | null; areaId: string | null; goalId: string | null }) => Promise<void> }): React.JSX.Element {
  const [name, setName] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [targetDate, setTargetDate] = useState(project?.targetDate ?? '')
  const [areaId, setAreaId] = useState(project?.areaId ?? initialAreaId ?? '')
  const [goalId, setGoalId] = useState(project?.goalId ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  return <AccessibleDialog className="modal project-editor-dialog" labelledBy="project-dialog-title" onCancel={onClose}>
    <h2 id="project-dialog-title">{project ? 'Edit project' : 'New project'}</h2><p className="modal-summary">Give related tasks a shared place and a clear target.</p>
    <form className="project-editor-form" onSubmit={(event) => { event.preventDefault(); if (saving) return; setSaving(true); setError(''); void onSave({ name, description, targetDate: targetDate || null, areaId: areaId || null, goalId: goalId || null }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setSaving(false)) }}>
      <label className="field"><span className="field-label">Project name</span><input value={name} maxLength={80} required autoFocus onChange={(event) => setName(event.target.value)} /></label>
      <label className="field"><span className="field-label">Description</span><textarea rows={3} maxLength={1500} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What belongs in this project?" /></label>
      <div className="form-grid"><label className="field"><span className="field-label">Area</span><select value={areaId} onChange={(event) => setAreaId(event.target.value)}><option value="">Unassigned</option>{areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label><label className="field"><span className="field-label">Goal</span><select value={goalId} onChange={(event) => setGoalId(event.target.value)}><option value="">No goal</option>{goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select></label><label className="field"><span className="field-label">Target date</span><input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /></label></div>
      {error && <p className="task-editor-error" role="alert">{error}</p>}
      <div className="modal-actions"><button className="btn btn-ghost" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="btn btn-primary" type="submit" disabled={saving || !name.trim()}>{saving ? 'Saving…' : project ? 'Save project' : 'Create project'}</button></div>
    </form>
  </AccessibleDialog>
}

function StageGlyph({ stage }: { stage: TaskWorkflowStage }): React.JSX.Element {
  return <span className={`project-stage-glyph stage-${stage}`} aria-hidden="true">{stage === 'next' ? <Icon name="board" /> : stage === 'in-progress' ? <Icon name="clock" /> : <Icon name="flag" />}</span>
}

function matches(value: string, query: string): boolean {
  const terms = query.normalize('NFKC').toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const content = value.normalize('NFKC').toLocaleLowerCase()
  return terms.every((term) => content.includes(term))
}

function getLocalDate(): string {
  const date = new Date()
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

function formatDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
