import { useEffect, useState } from 'react'
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

  const load = async (): Promise<void> => {
    const next = await window.assist.getResearchProjects()
    setProjects(next)
    if (!selectedId && next[0]) setSelectedId(next[0].id)
    if (selectedId && !next.some((project) => project.id === selectedId)) setSelectedId(next[0]?.id ?? '')
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
    } finally { setBusy(false) }
  }

  const addSource = async (): Promise<void> => {
    if (!selected || !url.trim()) return
    setBusy(true); setError(''); setNotice('Fetching source through the permission gateway…')
    try {
      const result = await window.assist.addResearchSource({ projectId: selected.id, url: url.trim() })
      if (!result.ok) { setError(result.error ?? 'Could not fetch that source.'); setNotice(''); return }
      setUrl(''); setProjects(result.projects ?? []); setNotice('Source captured locally.')
    } finally { setBusy(false) }
  }

  const removeProject = async (): Promise<void> => {
    if (!selected || !window.confirm(`Remove “${selected.title}” and its captured sources?`)) return
    const result = await window.assist.removeResearchProject(selected.id)
    if (result.ok) { setProjects(result.projects ?? []); setSelectedId(''); setNotice('Project removed.') }
    else setError(result.error ?? 'Could not remove the project.')
  }

  const saveToVault = async (source: ResearchProject['sources'][number]): Promise<void> => {
    const result = await window.assist.createVaultDocument({ title: source.title, body: source.content, tags: ['research'], sourceType: 'research', sourceRef: source.url })
    if (result.ok) setNotice('Source saved to the Knowledge Vault.')
    else setError(result.error ?? 'Could not save the source to the vault.')
  }

  return (
    <div className="research-view">
      <div className="research-layout">
        <aside className="research-projects">
          <div className="research-heading"><div><span className="eyebrow">Desk</span><h2>Research</h2></div><span className="count-badge">{projects.length}</span></div>
          <div className="research-project-list">
            {projects.map((project) => (
              <button key={project.id} type="button" className={`research-project ${selected?.id === project.id ? 'active' : ''}`} onClick={() => setSelectedId(project.id)}>
                <strong>{project.title}</strong><span>{project.sources.length} source{project.sources.length === 1 ? '' : 's'}</span>
              </button>
            ))}
            {projects.length === 0 && <p className="muted">Start a focused question, then gather sources without losing the thread.</p>}
          </div>
          <div className="research-new-form">
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Project title" aria-label="Research project title" />
            <textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What are you trying to understand?" rows={3} aria-label="Research question" />
            <button className="primary-button" type="button" disabled={busy || !title.trim() || !question.trim()} onClick={() => void create()}>New project</button>
          </div>
        </aside>

        <section className="research-main">
          {!selected ? <div className="research-empty"><div className="research-empty-mark">◎</div><h2>Your research desk</h2><p>Create a project to collect allowlisted web sources, compare evidence, and save useful material into the vault.</p></div> : (
            <>
              <div className="research-header"><div><span className="eyebrow">Active question</span><h2>{selected.title}</h2><p>{selected.question}</p></div><button className="danger-button" type="button" onClick={() => void removeProject()}>Remove</button></div>
              <div className="research-source-add"><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" aria-label="Research source URL" /><button className="primary-button" type="button" disabled={busy || !url.trim()} onClick={() => void addSource()}>{busy ? 'Working…' : 'Fetch source'}</button></div>
              <div className="research-sources">
                {selected.sources.map((source) => <article className="research-source-card" key={source.id}><div className="research-source-top"><div><h3>{source.title}</h3><a href={source.url} target="_blank" rel="noreferrer">{source.url}</a></div><span className="source-size">{source.contentChars.toLocaleString()} chars</span></div><details><summary>Read captured text</summary><pre>{source.content}</pre></details><div className="research-source-actions"><button className="ghost-button" type="button" onClick={() => void saveToVault(source)}>Save to Vault</button><button className="danger-button" type="button" onClick={async () => { const result = await window.assist.removeResearchSource(source.id); if (result.projects) setProjects(result.projects) }}>Remove</button></div></article>)}
                {selected.sources.length === 0 && <p className="muted research-no-sources">No sources yet. Add an HTTPS page from a domain you have allowlisted in Settings.</p>}
              </div>
            </>
          )}
          {(error || notice) && <p className={`research-status ${error ? 'status-error' : 'status-ok'}`}>{error || notice}</p>}
        </section>
      </div>
    </div>
  )
}
