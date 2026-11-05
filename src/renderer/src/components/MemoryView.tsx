import { useCallback, useEffect, useState } from 'react'
import type {
  MemoryFact,
  MemoryFactInput,
  MemoryFactPatch,
  MemoryScope
} from '../../../shared/types'

const SCOPES: MemoryScope[] = ['personal', 'teaching', 'business', 'general']
const DELETE_TOKEN = 'DELETE'

export function MemoryView({
  disabled,
  version,
  onChanged
}: {
  /** True while the agent or a direct tool call owns the queue. */
  disabled: boolean
  /** Bumped by App whenever memory may have changed elsewhere (e.g. chat saves). */
  version: number
  /** Called after any successful local change so App can refresh counts. */
  onChanged: () => void
}): React.JSX.Element {
  const [facts, setFacts] = useState<MemoryFact[]>([])
  const [archived, setArchived] = useState<MemoryFact[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [draftText, setDraftText] = useState('')
  const [draftScope, setDraftScope] = useState<MemoryScope>('general')
  const [draftBusy, setDraftBusy] = useState(false)
  const [draftNotice, setDraftNotice] = useState<{ ok: boolean; text: string } | null>(null)

  const [search, setSearch] = useState('')
  const [searchBusy, setSearchBusy] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [matches, setMatches] = useState<MemoryFact[] | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editScope, setEditScope] = useState<MemoryScope>('general')
  const [editBusy, setEditBusy] = useState(false)

  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [confirmToken, setConfirmToken] = useState('')

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setLoadError('')
    try {
      const [active, archivedList] = await Promise.all([
        window.assist.getMemory(),
        window.assist.getMemory('@archived')
      ])
      setFacts(active)
      setArchived(archivedList)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, version])

  const addFact = useCallback(async (): Promise<void> => {
    const text = draftText.trim()
    if (!text || draftBusy || disabled) return
    setDraftBusy(true)
    setDraftNotice(null)
    try {
      const input: MemoryFactInput = { text, scope: draftScope }
      const result = await window.assist.addMemory(input)
      if (result.ok) {
        setDraftText('')
        setDraftNotice({ ok: true, text: 'Approved and saved to memory.' })
        onChanged()
        await refresh()
      } else {
        setDraftNotice({ ok: false, text: result.error ?? 'Save did not complete.' })
      }
    } catch (error) {
      setDraftNotice({ ok: false, text: error instanceof Error ? error.message : String(error) })
    } finally {
      setDraftBusy(false)
    }
  }, [draftText, draftScope, draftBusy, disabled, onChanged, refresh])

  const startEdit = (fact: MemoryFact): void => {
    setEditingId(fact.id)
    setEditText(fact.text)
    setEditScope(fact.scope)
  }

  const applyEdit = useCallback(async (fact: MemoryFact): Promise<void> => {
    if (editBusy) return
    setEditBusy(true)
    try {
      const patch: MemoryFactPatch = { text: editText, scope: editScope }
      const result = await window.assist.updateMemory(fact.id, patch)
      if (result.ok) {
        setEditingId(null)
        onChanged()
        await refresh()
      } else {
        setLoadError(result.error ?? 'Could not update the fact.')
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setEditBusy(false)
    }
  }, [editBusy, editText, editScope, onChanged, refresh])

  const archive = useCallback(async (id: string): Promise<void> => {
    if (disabled) return
    try {
      const result = await window.assist.archiveMemory(id)
      if (result.ok) {
        onChanged()
        await refresh()
      } else {
        setLoadError(result.error ?? 'Could not archive the fact.')
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    }
  }, [disabled, onChanged, refresh])

  const remove = useCallback(async (id: string): Promise<void> => {
    if (disabled) return
    try {
      const result = await window.assist.deleteMemory(id)
      if (result.ok) {
        setConfirmingId(null)
        setConfirmToken('')
        onChanged()
        await refresh()
      } else {
        setLoadError(result.error ?? 'Could not delete the fact.')
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    }
  }, [disabled, onChanged, refresh])

  const runSearch = useCallback(async (): Promise<void> => {
    const query = search.trim()
    if (!query || searchBusy) return
    setSearchBusy(true)
    setSearchError('')
    try {
      const result = await window.assist.recallMemory(query, 10)
      if (result.ok && result.recall) {
        const resolved = result.recall.facts.map((match) => {
          const found = facts.find((fact) => fact.id === match.id)
          if (found) return found
          return {
            id: match.id,
            text: match.text,
            scope: match.scope,
            source: { kind: 'user' as const },
            createdAt: match.updatedAt,
            updatedAt: match.updatedAt,
            reviewAt: null,
            archivedAt: null
          } satisfies MemoryFact
        })
        setMatches(resolved)
      } else {
        setSearchError(result.error ?? 'Search did not complete.')
      }
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : String(error))
    } finally {
      setSearchBusy(false)
    }
  }, [search, searchBusy, facts])

  const viewList = matches ?? facts

  return (
    <div className="memory">
      <section className="memory-add">
        <h2 className="section-title">Save a fact yourself</h2>
        <p className="muted">Saves open the same approval card as chat saves. Facts stay on this device.</p>
        <div className="memory-add-row">
          <input
            type="text"
            value={draftText}
            placeholder="e.g. Mike teaches IELTS in Denizli"
            maxLength={400}
            disabled={disabled || draftBusy}
            aria-label="New memory fact"
            onChange={(event) => setDraftText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) void addFact()
            }}
          />
          <select
            value={draftScope}
            disabled={disabled || draftBusy}
            aria-label="Memory scope"
            onChange={(event) => setDraftScope(event.target.value as MemoryScope)}
          >
            {SCOPES.map((scope) => <option key={scope} value={scope}>{scope}</option>)}
          </select>
          <button
            className="btn btn-primary"
            type="button"
            disabled={disabled || draftBusy || draftText.trim().length < 3}
            onClick={() => void addFact()}
          >
            {draftBusy ? 'Waiting…' : 'Save fact'}
          </button>
        </div>
        {draftNotice && <p className={draftNotice.ok ? 'memory-notice' : 'memory-error'} role={draftNotice.ok ? 'status' : 'alert'}>{draftNotice.text}</p>}
      </section>

      <section className="memory-search">
        <h2 className="section-title">Search memory</h2>
        <div className="memory-add-row">
          <input
            type="text"
            value={search}
            placeholder="Keywords, e.g. Denizli IELTS"
            maxLength={200}
            disabled={searchBusy}
            aria-label="Memory search"
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) void runSearch()
            }}
          />
          <button className="btn" type="button" disabled={searchBusy || !search.trim()} onClick={() => void runSearch()}>
            Search
          </button>
          {matches && (
            <button className="btn btn-ghost" type="button" onClick={() => { setMatches(null); setSearch('') }}>
              Clear
            </button>
          )}
        </div>
        {searchError && <p className="memory-error" role="alert">{searchError}</p>}
      </section>

      {loadError && <div className="memory-error" role="alert">{loadError}</div>}
      {loading && <p className="muted" role="status">Loading memory…</p>}

      <section className="memory-list">
        <h2 className="section-title">
          {matches ? `Search matches (${viewList.length})` : `Active facts (${loading || loadError ? '—' : facts.length})`}
        </h2>
        {viewList.map((fact) => (
          <article key={fact.id} className="memory-card">
            <header className="memory-card-top">
              <span className={`scope-badge scope-${fact.scope}`}>{fact.scope}</span>
              <span className="muted">from {fact.source.kind} · updated {formatWhen(fact.updatedAt)}</span>
            </header>

            {editingId === fact.id ? (
              <>
                <div className="memory-add-row">
                  <input
                    type="text"
                    value={editText}
                    maxLength={400}
                    aria-label="Edit fact text"
                    disabled={editBusy}
                    onChange={(event) => setEditText(event.target.value)}
                  />
                  <select
                    value={editScope}
                    aria-label="Edit fact scope"
                    disabled={editBusy}
                    onChange={(event) => setEditScope(event.target.value as MemoryScope)}
                  >
                    {SCOPES.map((scope) => <option key={scope} value={scope}>{scope}</option>)}
                  </select>
                </div>
                <div className="memory-actions">
                  <button className="btn btn-primary" type="button" disabled={editBusy} onClick={() => void applyEdit(fact)}>
                    Save change
                  </button>
                  <button className="btn btn-ghost" type="button" disabled={editBusy} onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <p className="memory-text">{fact.text}</p>
            )}

            {fact.reviewAt && <p className="muted">Review after {formatWhen(fact.reviewAt)}</p>}

            {editingId !== fact.id && !matches && (
              <div className="memory-actions">
                <button className="btn btn-ghost" type="button" disabled={disabled} onClick={() => startEdit(fact)}>
                  Edit
                </button>
                <button className="btn btn-ghost" type="button" disabled={disabled} onClick={() => void archive(fact.id)}>
                  Archive
                </button>
                {confirmingId === fact.id ? (
                  <>
                    <input
                      type="text"
                      value={confirmToken}
                      placeholder={`Type ${DELETE_TOKEN}`}
                      maxLength={20}
                      aria-label={`Type ${DELETE_TOKEN} to confirm deleting this fact`}
                      className="delete-token-input"
                      onChange={(event) => setConfirmToken(event.target.value)}
                    />
                    <button
                      className="btn btn-danger"
                      type="button"
                      disabled={disabled || confirmToken.trim().toLocaleUpperCase() !== DELETE_TOKEN}
                      onClick={() => void remove(fact.id)}
                    >
                      Delete forever
                    </button>
                    <button className="btn btn-ghost" type="button" onClick={() => { setConfirmingId(null); setConfirmToken('') }}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button className="btn btn-danger" type="button" disabled={disabled} onClick={() => { setConfirmingId(fact.id); setConfirmToken('') }}>
                    Delete
                  </button>
                )}
              </div>
            )}
          </article>
        ))}

        {!loading && !loadError && viewList.length === 0 && (
          <div className="memory-empty">
            <div className="memory-empty-mark">◈</div>
            <p>{matches ? 'No facts matched that search.' : 'No facts yet. Try /remember in chat, or save one above.'}</p>
          </div>
        )}
      </section>

      <section className="memory-archived">
        <details>
          <summary>Archived ({loading || loadError ? '—' : archived.length})</summary>
          {archived.map((fact) => (
            <article key={fact.id} className="memory-card archived">
              <header className="memory-card-top">
                <span className={`scope-badge scope-${fact.scope}`}>{fact.scope}</span>
                <span className="muted">archived {formatWhen(fact.updatedAt)}</span>
              </header>
              <p className="memory-text">{fact.text}</p>
            </article>
          ))}
          {!loading && !loadError && archived.length === 0 && <p className="muted">Nothing archived yet.</p>}
        </details>
      </section>
    </div>
  )
}

function formatWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
