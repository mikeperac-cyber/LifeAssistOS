import { useEffect, useState } from 'react'
import type { VaultDocument, VaultSearchResult } from '../../../shared/types'

export function VaultView(): React.JSX.Element {
  const [results, setResults] = useState<VaultSearchResult[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<VaultDocument | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tags, setTags] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async (text = query): Promise<void> => setResults(await window.assist.getVaultDocuments(text))
  useEffect(() => { void load('') }, [])

  const open = (document: VaultDocument): void => { setSelected(document); setTitle(document.title); setBody(document.body); setTags(document.tags.join(', ')); setError(''); setNotice('') }
  const reset = (): void => { setSelected(null); setTitle(''); setBody(''); setTags(''); setNotice(''); setError('') }
  const save = async (): Promise<void> => {
    setBusy(true); setError(''); setNotice('')
    try {
      const result = selected ? await window.assist.updateVaultDocument(selected.id, { title, body, tags: tags.split(',') }) : await window.assist.createVaultDocument({ title, body, tags: tags.split(','), sourceType: 'manual' })
      if (!result.ok || !result.document) { setError(result.error ?? 'Could not save the document.'); return }
      setSelected(result.document); setNotice('Saved to the Knowledge Vault.'); await load('')
    } finally { setBusy(false) }
  }
  const remove = async (): Promise<void> => {
    if (!selected || !window.confirm(`Delete “${selected.title}” permanently?`)) return
    const result = await window.assist.deleteVaultDocument(selected.id)
    if (result.ok) { reset(); await load(''); setNotice('Document deleted.') } else setError(result.error ?? 'Could not delete the document.')
  }

  return <div className="vault-view"><div className="vault-toolbar"><div><span className="eyebrow">Local knowledge</span><h2>Knowledge Vault</h2><p>Search your captured research, teaching notes, and reusable ideas with SQLite FTS5.</p></div><button className="primary-button" type="button" onClick={reset}>New document</button></div><div className="vault-layout"><section className="vault-results"><div className="vault-search"><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void load() }} placeholder="Search the vault…" aria-label="Search knowledge vault" /><button className="ghost-button" type="button" onClick={() => void load()}>Search</button></div>{results.map((result) => <button className={`vault-result ${selected?.id === result.document.id ? 'active' : ''}`} key={result.document.id} type="button" onClick={() => open(result.document)}><strong>{result.document.title}</strong><span>{result.document.tags.join(' · ') || result.document.sourceType}</span><p>{result.snippet}</p></button>)}{results.length === 0 && <p className="muted vault-empty">No documents yet. Capture a source from Research or write your first note.</p>}</section><section className="vault-editor"><div className="vault-editor-head"><span className="eyebrow">{selected ? 'Edit document' : 'New document'}</span>{selected && <button className="danger-button" type="button" onClick={() => void remove()}>Delete</button>}</div><input className="vault-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Document title" aria-label="Vault document title" /><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Tags, comma separated" aria-label="Vault document tags" /><textarea className="vault-body" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write or paste durable knowledge here…" aria-label="Vault document content" /><div className="vault-editor-actions"><button className="primary-button" type="button" disabled={busy || !title.trim() || !body.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Save document'}</button>{(error || notice) && <span className={error ? 'status-error' : 'status-ok'}>{error || notice}</span>}</div></section></div></div>
}
