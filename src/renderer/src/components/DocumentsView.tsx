import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LocalDocument } from '../../../shared/ipc'
import { Icon } from './Icon'
import './documents.css'

const addedDateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

export function DocumentsView(): React.JSX.Element {
  const [documents, setDocuments] = useState<LocalDocument[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const result = await window.assist.listDocuments()
      if (!result.ok) throw new Error(result.error ?? 'The local document library could not be opened.')
      setDocuments(result.documents ?? [])
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The local document library could not be opened.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const filteredDocuments = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return [...documents]
      .filter((document) => !normalizedQuery || `${document.name} ${document.extension}`.toLocaleLowerCase().includes(normalizedQuery))
      .sort((first, second) => second.addedAt.localeCompare(first.addedAt))
  }, [documents, query])

  const addDocuments = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const result = await window.assist.addDocuments()
      if (!result.ok) throw new Error(result.error ?? 'Could not add those files.')
      if (result.cancelled) return
      const nextDocuments = result.documents ?? []
      const addedCount = nextDocuments.length - documents.length
      setDocuments(nextDocuments)
      setNotice(addedCount > 0 ? `${addedCount} ${addedCount === 1 ? 'file link is' : 'file links are'} ready.` : 'Those files are already in your library.')
      window.setTimeout(() => setNotice(''), 3000)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add those files.')
    } finally {
      setBusy(false)
    }
  }

  const openDocument = async (document: LocalDocument): Promise<void> => {
    setError('')
    try {
      const result = await window.assist.openDocument(document.id)
      if (!result.ok) setError(result.error ?? `Could not open ${document.name}.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not open ${document.name}.`)
    }
  }

  const revealDocument = async (document: LocalDocument): Promise<void> => {
    setError('')
    try {
      const result = await window.assist.revealDocument(document.id)
      if (!result.ok) setError(result.error ?? `Could not show ${document.name} in its folder.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not show ${document.name} in its folder.`)
    }
  }

  const removeDocument = async (document: LocalDocument): Promise<void> => {
    if (!window.confirm(`Remove “${document.name}” from this library? The original file will stay where it is.`)) return
    setError('')
    try {
      const result = await window.assist.removeDocument(document.id)
      if (!result.ok) {
        setError(result.error ?? `Could not remove ${document.name}.`)
        return
      }
      setDocuments((current) => current.filter((item) => item.id !== document.id))
      setNotice('Removed from your library. The original file is unchanged.')
      window.setTimeout(() => setNotice(''), 3000)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not remove ${document.name}.`)
    }
  }

  return <section className="documents-view" aria-label="Documents" aria-busy={loading}>
    <header className="documents-heading">
      <div>
        <h2>Your local files</h2>
        <p>Keep important files close to your plans. LifeAssistOS stores a local link only; it does not copy files or include links in backups or encrypted folder sync.</p>
      </div>
      <button type="button" className="documents-add-button" onClick={() => void addDocuments()} disabled={busy}>
        <Icon name="plus" />{busy ? 'Adding…' : 'Add documents'}
      </button>
    </header>

    {notice && <p className="documents-notice" role="status">{notice}</p>}
    {error && <div className="documents-error" role="alert"><span>{error}</span><button type="button" onClick={() => void refresh()}>Retry</button></div>}

    <label className="documents-search">
      <Icon name="search" />
      <span className="sr-only">Search documents</span>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your files" />
    </label>

    {loading && <p className="documents-loading" role="status">Opening your local library…</p>}
    {!loading && filteredDocuments.length > 0 && <div className="documents-grid">
      {filteredDocuments.map((document) => <article className={`document-card${document.exists ? '' : ' unavailable'}`} key={document.id}>
        <div className="document-card-top">
          <span className="document-file-icon"><Icon name="documents" /></span>
          <span className="document-extension">{document.extension || 'FILE'}</span>
        </div>
        <h3 title={document.name}>{document.name}</h3>
        <p className="document-meta">{formatFileSize(document.size)} <span aria-hidden="true">·</span> Added {formatAddedDate(document.addedAt)}</p>
        {!document.exists && <p className="document-missing" role="status">File not found at its saved location</p>}
        <div className="document-actions">
          <button type="button" className="document-open-button" onClick={() => void openDocument(document)} disabled={!document.exists}>Open file</button>
          <button type="button" className="document-secondary-button" onClick={() => void revealDocument(document)} disabled={!document.exists}>Show folder</button>
          <button type="button" className="document-remove-button" aria-label={`Remove ${document.name} from library`} onClick={() => void removeDocument(document)}>Remove</button>
        </div>
      </article>)}
    </div>}

    {!loading && filteredDocuments.length === 0 && documents.length > 0 && <div className="documents-empty documents-empty-search">
      <span className="documents-empty-icon"><Icon name="search" /></span>
      <h3>No matching files</h3>
      <p>Try a different name or file type.</p>
    </div>}
    {!loading && documents.length === 0 && <div className="documents-empty">
      <span className="documents-empty-icon"><Icon name="documents" /></span>
      <h3>Your documents, in one place</h3>
      <p>Add links to files on this device. You can open them or jump to their folder whenever you need them.</p>
      <button type="button" className="documents-add-button" onClick={() => void addDocuments()} disabled={busy}><Icon name="plus" />Add your first document</button>
    </div>}
  </section>
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}

function formatAddedDate(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? addedDateFormat.format(date) : 'recently'
}
