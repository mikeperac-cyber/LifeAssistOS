import { useEffect, useRef, useState } from 'react'
import type { ApprovalChoice, PermissionRequest } from '../../../shared/types'

export function ApprovalModal({
  request,
  onRespond
}: {
  request: PermissionRequest
  onRespond: (choice: ApprovalChoice) => void
}): React.JSX.Element {
  const denyRef = useRef<HTMLButtonElement>(null)
  const [token, setToken] = useState('')
  const confirm = request.confirm
  const tokenOk =
    !confirm || token.trim().toLocaleUpperCase() === confirm.expects.toLocaleUpperCase()

  useEffect(() => {
    denyRef.current?.focus()
  }, [])

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onRespond('deny')
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onRespond])

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="approval-title">
        <div className="modal-top">
          <span className="modal-kicker">
            <span className="shield-dot" />
            Permission gateway
          </span>
          {request.source === 'local_api' && <span className="field-tag">Local API request</span>}
          <span className={`pill risk-${request.risk}`}>{request.risk}</span>
        </div>

        <h2 id="approval-title">Approve this action?</h2>
        <p className="modal-summary">{request.summary}</p>

        <div className="modal-meta">
          <div className="meta-row">
            <span>Tool</span>
            <code>{request.tool}</code>
          </div>
          {request.scope && (
            <div className="meta-row">
              <span>Scope</span>
              <code>{request.scope}</code>
            </div>
          )}
        </div>

        {request.preview && <pre className="modal-preview">{request.preview}</pre>}

        {request.tainted && (
          <div className="taint-warning">
            This write may use untrusted content from the web, email, a helper, MCP, or a command. Check the proposed content carefully.
          </div>
        )}

        {confirm && (
          <div className="verb-confirm">
            <strong>{confirm.prompt}</strong>
            <label className="verb-confirm-row">
              Type <code>{confirm.expects}</code> to confirm:
              <input
                type="text"
                value={token}
                autoComplete="off"
                spellCheck={false}
                maxLength={32}
                aria-label={`Type ${confirm.expects} to confirm this action`}
                onChange={(event) => setToken(event.target.value)}
              />
            </label>
          </div>
        )}

        <div className="modal-warning">
          {confirm ? (
            <><strong>Approve once</strong> is the only option. This kind of action is never
              remembered, not even for one chat.</>
          ) : request.sessionApprovalAllowed === false ? (
            <><strong>Approve once</strong> applies only to this action. This permission will not be
              remembered for future calls.</>
          ) : (
            <><strong>Approve once</strong> applies only to this call. Session approval remembers only
              this exact tool, folder, path, and arguments until you close Mike Assist.</>
          )}
        </div>

        <div className="modal-actions">
          <button ref={denyRef} className="btn btn-ghost" type="button" onClick={() => onRespond('deny')}>
            Deny
          </button>
          <button
            className="btn btn-primary"
            type="button"
            disabled={!tokenOk}
            onClick={() => tokenOk && onRespond('once')}
          >
            {confirm ? `Approve once (type ${confirm.expects})` : 'Approve once'}
          </button>
          {request.sessionApprovalAllowed !== false && (
            <button className="btn btn-session" type="button" onClick={() => onRespond('session')}>
              Allow exact action this chat
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
