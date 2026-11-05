import { useEffect, useState } from 'react'
import type { VaultDocument, VaultSearchResult } from '../../../shared/types'

export function VaultView({ initialDocument, onInitialDocumentConsumed }: { initialDocument?: VaultDocument | null; onInitialDocumentConsumed?: () => void }): React.JSX.Element {
  const [results, setResults] = useState<VaultSearchResult[]>([])
  const [query, setQuery] = useState('')
  const [searchedQuery, setSearchedQuery] = useState('')
  const [selected, setSelected] = useState<VaultDocument | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tags, setTags] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = async (text = query): Promise<void> => {
    setLoading(true)
    setLoadError('')
    try {
      setResults(await window.assist.getVaultDocuments(text))
      setSearchedQuery(text)
    } catch (cause) {
      setResults([])
      setLoadError(errorText(cause, 'Could not load Knowledge Vault documents.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load('') }, [])

  const open = (document: VaultDocument): void => {
    setSelected(document)
    setTitle(document.title)
    setBody(document.body)
    setTags(document.tags.join(', '))
    setError('')
    setNotice('')
  }

  useEffect(() => {
    if (!initialDocument) return
    open(initialDocument)
    onInitialDocumentConsumed?.()
  }, [initialDocument, onInitialDocumentConsumed])

  const reset = (): void => {
    setSelected(null)
    setTitle('')
    setBody('')
    setTags('')
    setNotice('')
    setError('')
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = selected
        ? await window.assist.updateVaultDocument(selected.id, { title, body, tags: tags.split(',') })
        : await window.assist.createVaultDocument({ title, body, tags: tags.split(','), sourceType: 'manual' })
      if (!result.ok || !result.document) {
        setError(result.error ?? 'Could not save the document.')
        return
      }
      setSelected(result.document)
      setNotice('Saved to the Knowledge Vault.')
      await load(query)
    } catch (cause) {
      setError(errorText(cause, 'Could not save the document.'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!selected || !window.confirm(`Delete “${selected.title}” permanently?`)) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await window.assist.deleteVaultDocument(selected.id)
      if (!result.ok) {
        setError(result.error ?? 'Could not delete the document.')
        return
      }
      reset()
      setNotice('Document deleted.')
      await load(query)
    } catch (cause) {
      setError(errorText(cause, 'Could not delete the document.'))
    } finally {
      setBusy(false)
    }
  }

  const emptyMessage = vaultEmptyMessage(searchedQuery)

  return (
    <div className="vault-view">
      <div className="vault-toolbar">
        <div>
          <span className="eyebrow">Local knowledge</span>
          <h2>Knowledge Vault</h2>
          <p>Search your captured research, teaching notes, and reusable ideas with SQLite FTS5.</p>
        </div>
        <button className="primary-button" type="button" disabled={busy} onClick={reset}>New document</button>
      </div>
      <div className="vault-layout">
        <section className="vault-results" aria-label="Knowledge Vault search results">
          <div className="vault-search">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void load() }}
              placeholder="Search the vault…"
              aria-label="Search knowledge vault"
              disabled={loading}
            />
            <button className="ghost-button" type="button" disabled={loading} onClick={() => void load()}>
              {loading ? 'Searching…' : 'Search'}
            </button>
          </div>
          {loading && <p className="muted vault-empty" role="status">Loading Knowledge Vault documents…</p>}
          {!loading && loadError && (
            <div className="vault-load-error">
              <p role="alert">{loadError}</p>
              <button className="ghost-button" type="button" onClick={() => void load()}>Retry</button>
            </div>
          )}
          {!loading && !loadError && results.map((result) => (
            <button
              className={`vault-result ${selected?.id === result.document.id ? 'active' : ''}`}
              key={result.document.id}
              type="button"
              aria-pressed={selected?.id === result.document.id}
              onClick={() => open(result.document)}
            >
              <strong>{result.document.title}</strong>
              <span>{result.document.tags.join(' · ') || result.document.sourceType}</span>
              <p>{result.snippet}</p>
            </button>
          ))}
          {!loading && !loadError && results.length === 0 && <p className="muted vault-empty">{emptyMessage}</p>}
        </section>
        <section className="vault-editor" aria-label={selected ? 'Edit Knowledge Vault document' : 'New Knowledge Vault document'}>
          <div className="vault-editor-head">
            <span className="eyebrow">{selected ? 'Edit document' : 'New document'}</span>
            {selected && <button className="danger-button" type="button" disabled={busy} onClick={() => void remove()}>Delete</button>}
          </div>
          <input className="vault-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Document title" aria-label="Vault document title" disabled={busy} />
          <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Tags, comma separated" aria-label="Vault document tags" disabled={busy} />
          <textarea className="vault-body" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write or paste durable knowledge here…" aria-label="Vault document content" disabled={busy} />
          <div className="vault-editor-actions">
            <button className="primary-button" type="button" disabled={busy || !title.trim() || !body.trim()} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save document'}
            </button>
            {error && <span className="status-error" role="alert">{error}</span>}
            {notice && <span className="status-ok" role="status">{notice}</span>}
          </div>
        </section>
      </div>
    </div>
  )
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : typeof error === 'string' && error ? error : fallback
}

export function vaultEmptyMessage(query: string): string {
  const trimmedQuery = query.trim()
  return trimmedQuery
    ? `No documents match “${trimmedQuery}”.`
    : 'No documents yet. Capture a source from Research or write your first note.'
}
