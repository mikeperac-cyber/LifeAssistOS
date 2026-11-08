import { useEffect, useRef, useState } from 'react'

export function QuickCaptureDialog({ open, onClose, onCaptured }: { open: boolean; onClose: () => void; onCaptured?: () => void }): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const busyRef = useRef(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      inputRef.current?.focus()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  useEffect(() => {
    if (open) return
    setDraft('')
    setError('')
    setSaved('')
  }, [open])

  const save = async (): Promise<void> => {
    const text = draft.trim()
    if (!text || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    setSaved('')
    try {
      const result = await window.assist.captureInbox(text)
      if (!result.ok || !result.snapshot) throw new Error(result.error ?? 'Could not save this capture.')
      onCaptured?.()
      if (dialogRef.current?.open) {
        setDraft('')
        setSaved('Saved to your Today inbox.')
        requestAnimationFrame(() => inputRef.current?.focus())
      }
    } catch (cause) {
      if (dialogRef.current?.open) setError(cause instanceof Error ? cause.message : 'Could not save this capture.')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="quick-capture-dialog"
      aria-labelledby="quick-capture-title"
      aria-describedby="quick-capture-description"
      onCancel={() => onClose()}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="quick-capture-content">
        <div className="quick-capture-header">
          <div>
            <span className="eyebrow">Today inbox</span>
            <h2 id="quick-capture-title">Quick capture</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onClose} aria-label="Close quick capture">Close</button>
        </div>
        <p id="quick-capture-description" className="quick-capture-description">
          Save a thought, reminder, or next step here. It stays on this device until you decide what to do with it.
        </p>
        <form onSubmit={(event) => { event.preventDefault(); void save() }}>
          <label className="quick-capture-label" htmlFor="quick-capture-input">What do you want to remember?</label>
          <textarea
            id="quick-capture-input"
            ref={inputRef}
            value={draft}
            maxLength={2_000}
            rows={4}
            disabled={busy}
            placeholder="Type a thought or next step…"
            onChange={(event) => { setDraft(event.target.value); setError(''); setSaved('') }}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault()
                void save()
              }
            }}
          />
          <div className="quick-capture-status" aria-live="polite">
            {error && <p className="quick-capture-error" role="alert">{error}</p>}
            {saved && <p className="quick-capture-saved" role="status">{saved}</p>}
          </div>
          <div className="quick-capture-footer">
            <span className="quick-capture-hint"><kbd>Ctrl</kbd> + <kbd>Enter</kbd> to save</span>
            <button className="primary-button" type="submit" disabled={busy || !draft.trim()}>
              {busy ? 'Saving…' : 'Save to Today'}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  )
}
