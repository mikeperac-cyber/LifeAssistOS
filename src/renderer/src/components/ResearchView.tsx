import { useEffect, useRef, useState } from 'react'
import type { ResearchProject } from '../../../shared/types'

export function ResearchView(): React.JSX.Element {
  const [projects, setProjects] = useState<ResearchProject[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [title, setTitle] = useState('')
  const [question, setQuestion] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const projectTitleRef = useRef<HTMLInputElement>(null)

  const load = async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const next = await window.assist.getResearchProjects()
      setProjects(next)
      setSelectedId((current) => !current && next[0]
        ? next[0].id
        : current && !next.some((project) => project.id === current)
          ? next[0]?.id ?? ''
          : current)
      setLoadFailed(false)
    } catch (cause) {
      setLoadFailed(true)
      setError(errorText(cause, 'Could not load research projects.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const selected = projects.find((project) => project.id === selectedId) ?? projects[0]

  const create = async (): Promise<void> => {
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await window.assist.createResearchProject({ title, question })
      if (!result.ok) { setError(result.error ?? 'Could not create the project.'); return }
      setTitle(''); setQuestion(''); setSelectedId(result.project?.id ?? ''); setProjects(result.projects ?? [])
      setNotice('Research project created.')
    } catch (cause) {
      setError(errorText(cause, 'Could not create the project.'))
    } finally { setBusy(false) }
  }

  const addSource = async (): Promise<void> => {
    if (!selected || !url.trim()) return
    setBusy(true); setError(''); setNotice('Fetching source through the permission gateway…')
    try {
      const result = await window.assist.addResearchSource({ projectId: selected.id, url: url.trim() })
      if (!result.ok) { setError(result.error ?? 'Could not fetch that source.'); setNotice(''); return }
      setUrl(''); setProjects(result.projects ?? []); setNotice('Source captured locally.')
    } catch (cause) {
      setError(errorText(cause, 'Could not fetch that source.'))
      setNotice('')
    } finally { setBusy(false) }
  }

  const removeProject = async (): Promise<void> => {
    if (!selected || !window.confirm(`Remove “${selected.title}” and its captured sources?`)) return
    setError('')
    setNotice('')
    try {
      const result = await window.assist.removeResearchProject(selected.id)
      if (result.ok) { setProjects(result.projects ?? []); setSelectedId(''); setNotice('Project removed.') }
      else setError(result.error ?? 'Could not remove the project.')
    } catch (cause) {
      setError(errorText(cause, 'Could not remove the project.'))
    }
  }

  const saveToVault = async (source: ResearchProject['sources'][number]): Promise<void> => {
    setError('')
    setNotice('')
    try {
      const result = await window.assist.createVaultDocument({ title: source.title, body: source.content, tags: ['research'], sourceType: 'research', sourceRef: source.url })
      if (result.ok) setNotice('Source saved to the Knowledge Vault.')
      else setError(result.error ?? 'Could not save the source to the vault.')
    } catch (cause) {
      setError(errorText(cause, 'Could not save the source to the vault.'))
    }
  }

  const removeSource = async (sourceId: string): Promise<void> => {
    setError('')
    setNotice('')
    try {
      const result = await window.assist.removeResearchSource(sourceId)
      if (result.projects) setProjects(result.projects)
      else setError(result.error ?? 'Could not remove the source.')
    } catch (cause) {
      setError(errorText(cause, 'Could not remove the source.'))
    }
  }

  return (
    <div className="research-view">
      <div className="research-layout">
        <aside className="research-projects">
          <div className="research-heading"><h2>Projects</h2><span className="count-badge">{loading ? '…' : loadFailed ? '—' : projects.length}</span></div>
          {!loading && !loadFailed && <div className="research-new-form">
            <h3>New project</h3>
            <input ref={projectTitleRef} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Project title" aria-label="Research project title" />
            <textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What are you trying to understand?" rows={3} aria-label="Research question" />
            <button className="primary-button" type="button" disabled={busy || !title.trim() || !question.trim()} onClick={() => void create()}>{busy ? 'Creating…' : 'Create project'}</button>
          </div>}
          <div className="research-project-list" aria-label="Saved research projects">
            {!loading && !loadFailed && projects.map((project) => (
              <button key={project.id} type="button" aria-pressed={selected?.id === project.id} className={`research-project ${selected?.id === project.id ? 'active' : ''}`} onClick={() => setSelectedId(project.id)}>
                <strong>{project.title}</strong><span>{project.sources.length} source{project.sources.length === 1 ? '' : 's'}</span>
              </button>
            ))}
            {loading && <p className="muted" role="status">Loading research projects…</p>}
            {loadFailed && <div className="research-load-error"><p role="alert">{error}</p><button className="ghost-button" type="button" onClick={() => void load()}>Retry</button></div>}
            {!loading && !loadFailed && projects.length === 0 && <p className="muted">Start a focused question, then gather sources without losing the thread.</p>}
          </div>
        </aside>

        <section className="research-main">
          {loading ? <p className="muted" role="status">Loading project details…</p> : loadFailed ? null : !selected ? <div className="research-empty"><h2>Start with one focused question</h2><p>Research keeps approved sources together, then lets you save useful notes into the Knowledge Vault.</p><ol className="research-empty-steps"><li><strong>Frame the question</strong><span>Give the project a clear title and a question you can investigate.</span></li><li><strong>Gather sources</strong><span>Add HTTPS pages from domains you have allowlisted in Settings.</span></li><li><strong>Keep what matters</strong><span>Save reliable material into the Knowledge Vault for later lessons and projects.</span></li></ol><button className="primary-button" type="button" onClick={() => projectTitleRef.current?.focus()}>Create your first project</button></div> : (
            <>
              <div className="research-header"><div><h2>{selected.title}</h2><p>{selected.question}</p></div><button className="danger-button" type="button" onClick={() => void removeProject()}>Remove</button></div>
              <div className="research-source-add"><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" aria-label="Research source URL" /><button className="primary-button" type="button" disabled={busy || !url.trim()} onClick={() => void addSource()}>{busy ? 'Working…' : 'Fetch source'}</button></div>
              <div className="research-sources">
                {selected.sources.map((source) => <article className="research-source-card" key={source.id}><div className="research-source-top"><div><h3>{source.title}</h3><a href={source.url} target="_blank" rel="noreferrer">{source.url}</a></div><span className="source-size">{source.contentChars.toLocaleString()} chars</span></div><details><summary>Read captured text</summary><pre>{source.content}</pre></details><div className="research-source-actions"><button className="ghost-button" type="button" onClick={() => void saveToVault(source)}>Save to Vault</button><button className="danger-button" type="button" onClick={() => void removeSource(source.id)}>Remove</button></div></article>)}
                {selected.sources.length === 0 && <p className="muted research-no-sources">No sources yet. Add an HTTPS page from a domain you have allowlisted in Settings.</p>}
              </div>
            </>
          )}
          {!loadFailed && (error || notice) && <p className={`research-status ${error ? 'status-error' : 'status-ok'}`} role={error ? 'alert' : 'status'}>{error || notice}</p>}
        </section>
      </div>
    </div>
  )
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : typeof error === 'string' && error ? error : fallback
}
