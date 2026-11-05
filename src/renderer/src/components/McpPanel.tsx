import { useCallback, useEffect, useState } from 'react'
import type { McpServerInfo, McpTransport } from '../../../shared/types'
import type { McpImportResult, McpMutationResult } from '../../../shared/ipc'

const STATUS_LABELS: Record<McpServerInfo['status'], string> = {
  disabled: 'off',
  connecting: 'connecting…',
  connected: 'connected',
  error: 'error',
  removed: 'gone'
}

/**
 * MCP connectors are configured here only. Mike Assist never installs or
 * launches anything on its own, every tool call asks, and results are treated
 * as untrusted data no matter what a server claims to be.
 */
export function McpPanel(): React.JSX.Element {
  const [servers, setServers] = useState<McpServerInfo[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const [addOpen, setAddOpen] = useState(false)
  const [transport, setTransport] = useState<McpTransport>('stdio')
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [argsText, setArgsText] = useState('')
  const [url, setUrl] = useState('')

  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')

  const refresh = useCallback(async (): Promise<void> => {
    const list = await window.assist.getMcpServers()
    setServers(list)
    setLoaded(true)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = useCallback(
    async (action: () => Promise<McpMutationResult>): Promise<boolean> => {
      if (busy) return false
      setBusy(true)
      setError('')
      setNotice('')
      try {
        const result = await action()
        if (result.ok) {
          setServers(result.servers ?? [])
          setNotice('Done.')
          return true
        } else {
          setError(result.error ?? 'The MCP change did not complete.')
          return false
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught))
        return false
      } finally {
        setBusy(false)
      }
    },
    [busy]
  )

  const addServer = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    const applied = await run(async () => {
      if (transport === 'stdio') {
        return window.assist.addMcpServer({
          name: trimmed,
          transport,
          command: command.trim(),
          args: argsText.trim() ? splitArgs(argsText) : [],
          enabled: true
        })
      }
      return window.assist.addMcpServer({ name: trimmed, transport, url: url.trim(), enabled: true })
    })
    if (applied) {
      setName('')
      setCommand('')
      setArgsText('')
      setUrl('')
      setAddOpen(false)
      try {
        const added = (await window.assist.getMcpServers()).find((server) => server.name === trimmed)
        setNotice(added?.status === 'connected' ? `Connected to ${trimmed}.` : `Saved ${trimmed}; check its status below.`)
      } catch {
        setNotice(`Saved ${trimmed}; check its status below.`)
      }
    }
  }

  const importConfig = async (): Promise<void> => {
    if (!importText.trim() || busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = (await window.assist.importMcpConfig(importText)) as McpImportResult
      if (result.ok) {
        setServers(result.servers ?? servers)
        setNotice(
          `Imported ${result.added ?? 0} connection${(result.added ?? 0) === 1 ? '' : 's'}` +
            (result.skipped ? `, skipped ${result.skipped}` : '') +
            '.'
        )
        setImportText('')
        setImportOpen(false)
      } else {
        setError(result.error ?? 'The import did not complete.')
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  const removeServer = async (id: string): Promise<void> => {
    if (confirmingId !== id) {
      setConfirmingId(id)
      return
    }
    const applied = await run(() => window.assist.removeMcpServer(id))
    if (applied) {
      setConfirmingId(null)
      setNotice('Connection removed and its tools are gone from chat.')
    }
  }

  return (
    <section className="settings-section mcp-panel">
      <div className="section-head">
        <h2>MCP connections</h2>
        <p>
          Connect Model Context Protocol servers by giving Mike Assist a command or address you chose.
          Nothing is installed, downloaded, or started by Mike Assist itself; every MCP tool call asks first,
          and tool results are handled as untrusted data.
        </p>
      </div>

      <div className="mcp-server-list">
        {servers.map((server) => (
          <div className="mcp-server-row" key={server.id}>
            <div className="mcp-server-main">
              <span className={`mcp-status mcp-${server.status}`} aria-label={`Server status: ${STATUS_LABELS[server.status]}`}>
                <span className="mcp-status-dot" />
                {STATUS_LABELS[server.status]}
              </span>
              <div className="mcp-server-text">
                <span className="mcp-server-name">{server.name}</span>
                <code className="mcp-server-detail">{server.detail || server.transport}</code>
                {server.error && <span className="mcp-server-error" role="alert">{server.error}</span>}
                <span className="muted">
                  {server.tools.length} tool{server.tools.length === 1 ? '' : 's'}
                  {server.truncated ? ' · capped at 24' : ''} · every call asks
                </span>
                {server.tools.length > 0 && (
                  <div className="mcp-tools">
                    {server.tools.map((tool) => (
                      <code key={tool.invocationName} title={tool.description}>
                        {tool.invocationName}
                      </code>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="mcp-server-actions">
              {confirmingId === server.id ? (
                <>
                  <span className="mcp-confirm-hint">Remove?</span>
                  <button className="danger-button" type="button" disabled={busy} onClick={() => void removeServer(server.id)}>
                    Confirm
                  </button>
                  <button className="ghost-button" type="button" onClick={() => setConfirmingId(null)}>
                    Keep
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => window.assist.updateMcpServer(server.id, { enabled: !server.enabled }))}
                  >
                    {server.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button className="ghost-button" type="button" disabled={busy || !server.enabled} onClick={() => void run(() => window.assist.refreshMcpServer(server.id))}>
                    Refresh tools
                  </button>
                  <button className="danger-button" type="button" disabled={busy} onClick={() => void removeServer(server.id)}>
                    Remove
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
        {loaded && servers.length === 0 && (
          <p className="muted mcp-empty">No connections yet. Add one below, or paste an mcpServers JSON block.</p>
        )}
      </div>

      <div className="mcp-add-controls">
        {!addOpen ? (
          <div className="settings-actions">
            <button className="ghost-button" type="button" onClick={() => setAddOpen(true)}>
              Add connection…
            </button>
            <button className="ghost-button" type="button" onClick={() => setImportOpen((open) => !open)}>
              {importOpen ? 'Hide import' : 'Import JSON…'}
            </button>
            <button className="ghost-button" type="button" disabled={busy} onClick={() => {
              setNotice('')
              void run(async () => {
                const results = await Promise.all(servers.filter((server) => server.enabled).map((server) => window.assist.refreshMcpServer(server.id)))
                const last = results[results.length - 1]
                return last ?? { ok: true, servers }
              })
            }}>
              Refresh all
            </button>
          </div>
        ) : null}
      </div>

      {addOpen && (
        <div className="mcp-add-form">
          <div className="mcp-field-row">
            <label>
              Name
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="files-server" maxLength={24} spellCheck={false} aria-label="Connection name" />
            </label>
            <label>
              Type
              <select value={transport} onChange={(event) => setTransport(event.target.value as McpTransport)} aria-label="Connection type">
                <option value="stdio">Local command (stdio)</option>
                <option value="http">HTTP server</option>
              </select>
            </label>
          </div>
          {transport === 'stdio' ? (
            <div className="mcp-field-row">
              <label className="mcp-grow">
                Command
                <input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="C:\path\to\server.exe" spellCheck={false} aria-label="Command to launch" />
              </label>
              <label className="mcp-grow">
                Arguments (space separated)
                <input value={argsText} onChange={(event) => setArgsText(event.target.value)} placeholder="--port 8080 --serve" spellCheck={false} aria-label="Command arguments" />
              </label>
            </div>
          ) : (
            <label className="mcp-grow">
              Server address (https, or http://127.0.0.1 for local servers)
              <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/mcp" spellCheck={false} aria-label="Server address" />
            </label>
          )}
          <div className="settings-actions">
            <button className="primary-button" type="button" disabled={busy || !name.trim()} onClick={() => void addServer()}>
              {busy ? 'Connecting…' : 'Save & connect'}
            </button>
            <button className="ghost-button" type="button" onClick={() => { setAddOpen(false); setError('') }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {importOpen && (
        <div className="mcp-import">
          <p className="muted">
            Paste a Claude-Desktop-style block. Only <code>command/args</code> and <code>url</code> entries are read;
            environment variables and other fields are ignored.
          </p>
          <textarea
            className="mcp-import-text"
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            rows={6}
            spellCheck={false}
            placeholder={'{\n  "mcpServers": {\n    "files": { "command": "node", "args": ["server.js"] }\n  }\n}'}
            aria-label="MCP configuration JSON"
          />
          <div className="settings-actions">
            <button className="primary-button" type="button" disabled={busy || !importText.trim()} onClick={() => void importConfig()}>
              {busy ? 'Importing…' : 'Import'}
            </button>
            <button className="ghost-button" type="button" onClick={() => { setImportOpen(false); setImportText('') }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {(error || notice) && (
        <span className={`settings-status ${error ? 'status-error' : ''}`} role={error ? 'alert' : 'status'}>{error || notice}</span>
      )}
    </section>
  )
}

/** Splits an arguments line the way a shell would, minus wildcard/expansion tricks. */
function splitArgs(text: string): string[] {
  const matches = text.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []
  return matches.map((entry) => entry.replace(/^"|"$/g, '')).filter(Boolean)
}
