import { useEffect, useState } from 'react'
import type { Risk } from '../../../shared/types'
import { formatBytes } from '../format'
import type { ToolCardState } from '../types'

const STATUS_LABEL: Record<ToolCardState['status'], string> = {
  pending: 'Queued',
  awaiting: 'Awaiting approval',
  running: 'Running',
  success: 'Done',
  denied: 'Denied',
  blocked: 'Blocked',
  failed: 'Failed'
}

const TOOL_GLYPH: Record<string, string> = {
  list_dir: '≡',
  read_file: '◧',
  read_pdf: '▤',
  read_office_document: '▤',
  write_file: '✎',
  list_file_checkpoints: '↶',
  restore_file_checkpoint: '↩',
  search_notes: '⌕',
  create_note: '✎',
  web_search: '⌕',
  web_fetch: '↗',
  create_email_draft: '✉',
  create_calendar_event: '◷'
}

export function ToolCardView({ card }: { card: ToolCardState }): React.JSX.Element {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (card.status === 'failed' || card.status === 'blocked' || card.status === 'denied') {
      setOpen(true)
    }
  }, [card.status])

  const risk: Risk = card.call.risk ?? 'read'

  return (
    <div className={`tool-card tool-status-${card.status}`}>
      <button
        className="tool-head"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="tool-icon">{TOOL_GLYPH[card.call.name] ?? '·'}</span>
        <span className="tool-name">{card.call.name}</span>
        <span className="tool-summary">{card.call.summary}</span>
        <span className={`pill risk-${risk}`}>{risk}</span>
        <span className={`pill status-${card.status}`}>{STATUS_LABEL[card.status]}</span>
        <span className={`chevron ${open ? 'open' : ''}`}>⌄</span>
      </button>

      {open && (
        <div className="tool-body">
          <div className="tool-section-label">Arguments</div>
          <pre className="tool-pre">{JSON.stringify(card.call.args, null, 2)}</pre>

          {card.result && <ResultBody card={card} />}
        </div>
      )}
    </div>
  )
}

function ResultBody({ card }: { card: ToolCardState }): React.JSX.Element | null {
  const result = card.result
  if (!result) return null

  if (result.denied || result.blocked || !result.ok) {
    return (
      <div className={`tool-error ${result.denied ? 'tool-denied' : ''}`}>
        {result.error ?? 'The action did not complete.'}
      </div>
    )
  }

  if (card.call.name === 'list_dir') {
    const output = result.output as
      | {
          path?: string
          entries?: Array<{ name: string; type: string; size?: number }>
          startIndex?: number
          totalEntries?: number
          nextIndex?: number
          truncated?: boolean
        }
      | undefined
    const entries = output?.entries ?? []
    const rangeStart = (output?.startIndex ?? 0) + (entries.length > 0 ? 1 : 0)
    const rangeEnd = (output?.startIndex ?? 0) + entries.length

    return (
      <div>
        <div className="tool-section-label">
          {output?.path ?? 'Workspace'} · {entries.length} item{entries.length === 1 ? '' : 's'}
          {output?.totalEntries !== undefined ? ` · ${rangeStart}-${rangeEnd} of ${output.totalEntries}` : ''}
        </div>
        <div className="dir-list">
          {entries.length === 0 && <div className="muted">This folder is empty.</div>}
          {entries.map((entry) => (
            <div className="dir-row" key={entry.name}>
              <span className={`dir-icon dir-${entry.type}`}>
                {entry.type === 'directory' ? '▸' : '·'}
              </span>
              <span className="dir-name">
                {entry.name}
                {entry.type === 'directory' ? '/' : ''}
              </span>
              {typeof entry.size === 'number' && (
                <span className="dir-size">{formatBytes(entry.size)}</span>
              )}
            </div>
          ))}
          {output?.truncated && <div className="muted">More entries are available. Continue at startIndex {output.nextIndex ?? rangeEnd}.</div>}
        </div>
      </div>
    )
  }

  if (card.call.name === 'read_file') {
    const output = result.output as
      | {
          path?: string
          content?: string
          truncated?: boolean
          bytes?: number
          startByte?: number
          bytesRead?: number
          nextByte?: number
        }
      | undefined

    return (
      <div>
        <div className="tool-section-label">
          {output?.path ?? 'File'} · {formatBytes(output?.bytesRead ?? output?.bytes ?? 0)} read · offset {formatBytes(output?.startByte ?? 0)}/{formatBytes(output?.bytes ?? 0)}
          {output?.truncated ? ` · truncated · next ${output.nextByte ?? 'unknown'}` : ''}
        </div>
        <pre className="tool-pre tool-content">{output?.content ?? ''}</pre>
      </div>
    )
  }

  if (card.call.name === 'read_pdf') {
    const output = result.output as
      | {
          path?: string
          text?: string
          bytes?: number
          totalPages?: number
          startPage?: number
          startChar?: number
          pagesRead?: number
          nextPage?: number
          nextChar?: number
          truncated?: boolean
          note?: string
        }
      | undefined

    return (
      <div>
        <div className="tool-section-label">
          {output?.path ?? 'PDF'} · {output?.pagesRead ?? 0} pages from {output?.startPage ?? 1}/{output?.totalPages ?? 0} · {formatBytes(output?.bytes ?? 0)}
          {output?.truncated ? ` · excerpt limited${output.nextPage !== undefined ? ` · next ${output.nextPage}:${output.nextChar ?? 0}` : ''}` : ''}
        </div>
        {output?.note && <div className="muted">{output.note}</div>}
        <pre className="tool-pre tool-content">{output?.text ?? ''}</pre>
      </div>
    )
  }

  if (card.call.name === 'read_office_document') {
    const output = result.output as
      | {
          path?: string
          format?: string
          text?: string
          bytes?: number
          truncated?: boolean
          note?: string
          totalSheets?: number
          startSheet?: number
          sheetsRead?: number
          totalChars?: number
          startChar?: number
          charsRead?: number
          nextChar?: number
          sheetRanges?: Array<{ sheet: number; name: string; totalRows: number; startRow: number; rowsRead: number; nextRow?: number }>
          nextSheet?: number
        }
      | undefined
    const sheetLabel = output?.format === 'xlsx'
      ? ` · ${output?.sheetsRead ?? 0}/${output?.totalSheets ?? 0} sheets${output?.sheetRanges?.length
        ? ` · ${output.sheetRanges.map((range) => `${range.name} rows ${range.rowsRead ? `${range.startRow}-${range.startRow + range.rowsRead - 1}` : 'none'}/${range.totalRows}${range.nextRow ? ` (next ${range.nextRow})` : ''}`).join('; ')}`
        : ''}${output?.nextSheet ? ` · next sheet ${output.nextSheet}` : ''}`
      : ''
    const wordLabel = output?.format === 'docx'
      ? ` · ${output?.charsRead ?? 0}/${output?.totalChars ?? 0} chars from ${output?.startChar ?? 0}${output?.nextChar !== undefined ? ` (next ${output.nextChar})` : ''}`
      : ''

    return (
      <div>
        <div className="tool-section-label">
          {output?.path ?? 'Office document'} · {output?.format?.toUpperCase() ?? 'Office'}{sheetLabel}{wordLabel} · {formatBytes(output?.bytes ?? 0)}
          {output?.truncated ? ' · more available' : ''}
        </div>
        {output?.note && <div className="muted">{output.note}</div>}
        <pre className="tool-pre tool-content">{output?.text ?? ''}</pre>
      </div>
    )
  }

  if (card.call.name === 'write_file') {
    const output = result.output as { path?: string; bytes?: number; checkpointId?: string } | undefined
    return (
      <div className="tool-success">
        Wrote {output?.path ?? 'the file'} · {formatBytes(output?.bytes ?? 0)}
        {output?.checkpointId && <div className="muted">Restore point saved · {output.checkpointId}</div>}
      </div>
    )
  }

  if (card.call.name === 'list_file_checkpoints') {
    const output = result.output as {
      path?: string
      checkpoints?: Array<{ id: string; createdAt: string; beforeExists: boolean; beforeBytes: number; afterExists: boolean }>
    } | undefined
    return (
      <div className="dir-list">
        <div className="tool-section-label">{output?.path ?? 'File'} · {output?.checkpoints?.length ?? 0} restore point(s)</div>
        {(output?.checkpoints ?? []).map((checkpoint) => (
          <div className="dir-row" key={checkpoint.id}>
            <span className="dir-icon">↶</span>
            <span className="dir-name">
              {new Date(checkpoint.createdAt).toLocaleString()} · {checkpoint.beforeExists ? `${formatBytes(checkpoint.beforeBytes)} previous content` : 'file did not exist'}
              {!checkpoint.afterExists ? ' · current state was removed' : ''}
            </span>
            <code>{checkpoint.id}</code>
          </div>
        ))}
        {(output?.checkpoints?.length ?? 0) === 0 && <div className="muted">No assistant restore points are available for this file.</div>}
      </div>
    )
  }

  if (card.call.name === 'restore_file_checkpoint') {
    const output = result.output as { path?: string; removed?: boolean; checkpointId?: string } | undefined
    return (
      <div className="tool-success">
        {output?.removed ? `Removed ${output.path ?? 'the file'} to restore its prior absence.` : `Restored ${output?.path ?? 'the file'}.`}
        {output?.checkpointId && <div className="muted">A redo point was saved · {output.checkpointId}</div>}
      </div>
    )
  }

  return <pre className="tool-pre">{JSON.stringify(result.output, null, 2)}</pre>
}
