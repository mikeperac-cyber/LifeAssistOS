import { useEffect, useRef, useState } from 'react'
import type {
  ConnectedCloudFile,
  ConnectedCloudFileReadInput,
  ConnectedCloudFileReadOutput,
  ConnectedFileProvider,
  PublicGoogleDriveSettings,
  PublicMicrosoftOneDriveSettings
} from '../../../shared/ipc'

const MAX_RETAINED_READ_PARTS = 10

function providerName(provider: ConnectedFileProvider): string {
  return provider === 'google_drive' ? 'Google Drive' : 'Microsoft OneDrive'
}

export function nextConnectedFileReadCursor(file: ConnectedCloudFile, output: ConnectedCloudFileReadOutput): Partial<ConnectedCloudFileReadInput> | null {
  if (!output.truncated) return null
  const mimeType = file.mimeType.toLowerCase()
  if (mimeType === 'application/pdf' && output.nextPage !== undefined) {
    return { startPage: output.nextPage, ...(output.nextChar !== undefined ? { startChar: output.nextChar } : {}) }
  }
  if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    const pendingRange = [...(output.sheetRanges ?? [])].reverse().find((range) => range.nextRow !== undefined)
    if (pendingRange?.nextRow !== undefined) return { startSheet: pendingRange.sheet, startRow: pendingRange.nextRow }
    if (output.nextSheet !== undefined) return { startSheet: output.nextSheet }
  }
  const nextChar = output.nextStartChar ?? output.nextChar
  return nextChar !== undefined ? { startChar: nextChar } : null
}

function displaySize(size: string | number | undefined): string | null {
  const bytes = typeof size === 'number' ? size : typeof size === 'string' && /^\d+$/.test(size) ? Number(size) : NaN
  if (!Number.isSafeInteger(bytes) || bytes < 0) return null
  if (bytes < 1_000) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1_000
  let unit = units[0]
  for (let index = 1; value >= 1_000 && index < units.length; index += 1) {
    value /= 1_000
    unit = units[index]
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${unit}`
}

function displayDate(value: string | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString()
}

export function ConnectedFilesView({
  googleDriveSettings,
  microsoftOneDriveSettings,
  disabled,
  onOpenSettings
}: {
  googleDriveSettings: PublicGoogleDriveSettings | null
  microsoftOneDriveSettings: PublicMicrosoftOneDriveSettings | null
  disabled: boolean
  onOpenSettings: () => void
}): React.JSX.Element {
  const googleConnected = googleDriveSettings?.connected === true
  const oneDriveConnected = microsoftOneDriveSettings?.connected === true
  const availableProviders: ConnectedFileProvider[] = [
    ...(googleConnected ? ['google_drive' as const] : []),
    ...(oneDriveConnected ? ['microsoft_onedrive' as const] : [])
  ]
  const [provider, setProvider] = useState<ConnectedFileProvider>(() => googleConnected ? 'google_drive' : 'microsoft_onedrive')
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<ConnectedCloudFile[]>([])
  const [nextPageToken, setNextPageToken] = useState<string | null>(null)
  const [searchNote, setSearchNote] = useState('')
  const [searchError, setSearchError] = useState('')
  const [hasSearched, setHasSearched] = useState(false)
  const [selectedFile, setSelectedFile] = useState<ConnectedCloudFile | null>(null)
  const [readParts, setReadParts] = useState<string[]>([])
  const [readOutput, setReadOutput] = useState<ConnectedCloudFileReadOutput | null>(null)
  const [readError, setReadError] = useState('')
  const [action, setAction] = useState<'search' | 'read' | null>(null)
  const requestVersion = useRef(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      requestVersion.current += 1
    }
  }, [])

  useEffect(() => {
    if (availableProviders.includes(provider)) return
    const fallback = availableProviders[0]
    requestVersion.current += 1
    if (fallback) setProvider(fallback)
    setAction(null)
    setFiles([])
    setNextPageToken(null)
    setSearchNote('')
    setSearchError('')
    setHasSearched(false)
    setSelectedFile(null)
    setReadParts([])
    setReadOutput(null)
    setReadError('')
  }, [availableProviders.join('|'), provider])

  const chooseProvider = (value: ConnectedFileProvider): void => {
    if (value === provider || disabled || action) return
    requestVersion.current += 1
    setProvider(value)
    setFiles([])
    setNextPageToken(null)
    setSearchNote('')
    setSearchError('')
    setHasSearched(false)
    setSelectedFile(null)
    setReadParts([])
    setReadOutput(null)
    setReadError('')
  }

  const search = async (pageToken?: string): Promise<void> => {
    const cleanQuery = query.trim()
    if (cleanQuery.length < 2 || cleanQuery.length > 120 || /[\u0000-\u001f\u007f]/.test(cleanQuery)) {
      setSearchError('Enter a search phrase between 2 and 120 printable characters.')
      return
    }
    const version = ++requestVersion.current
    setAction('search')
    setSearchError('')
    setReadError('')
    setSearchNote('')
    if (!pageToken) {
      setFiles([])
      setNextPageToken(null)
      setSelectedFile(null)
      setReadParts([])
      setReadOutput(null)
      setHasSearched(false)
    }
    try {
      const result = provider === 'google_drive'
        ? await window.assist.searchGoogleDriveFiles(cleanQuery, pageToken)
        : await window.assist.searchMicrosoftOneDriveFiles(cleanQuery)
      if (!mounted.current || version !== requestVersion.current) return
      if (!result.ok || !result.files) {
        setSearchError(result.error ?? `${providerName(provider)} search did not return file results.`)
        return
      }
      setFiles((previous) => {
        if (!pageToken) return result.files!
        const seen = new Set(previous.map((file) => file.id))
        return [...previous, ...result.files!.filter((file) => {
          if (seen.has(file.id)) return false
          seen.add(file.id)
          return true
        })]
      })
      setNextPageToken(result.nextPageToken ?? null)
      setSearchNote(result.note ?? '')
      setHasSearched(true)
    } catch (error) {
      if (mounted.current && version === requestVersion.current) {
        setSearchError(error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (mounted.current && version === requestVersion.current) setAction(null)
    }
  }

  const readFile = async (file: ConnectedCloudFile, cursor?: Partial<ConnectedCloudFileReadInput>): Promise<void> => {
    const version = ++requestVersion.current
    setAction('read')
    setReadError('')
    try {
      const input: ConnectedCloudFileReadInput = {
        fileId: file.id,
        fileName: file.name,
        mimeType: file.mimeType,
        maxChars: 5_000,
        ...cursor
      }
      const result = provider === 'google_drive'
        ? await window.assist.readGoogleDriveFile(input)
        : await window.assist.readMicrosoftOneDriveFile(input)
      if (!mounted.current || version !== requestVersion.current) return
      if (!result.ok || !result.output) {
        setReadError(result.error ?? 'The file could not be read.')
        return
      }
      setSelectedFile(file)
      setReadOutput(result.output)
      setReadParts((previous) => [...previous, result.output!.text].slice(0, MAX_RETAINED_READ_PARTS))
    } catch (error) {
      if (mounted.current && version === requestVersion.current) {
        setReadError(error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (mounted.current && version === requestVersion.current) setAction(null)
    }
  }

  const changeFile = (file: ConnectedCloudFile): void => {
    setSelectedFile(file)
    setReadParts([])
    setReadOutput(null)
    setReadError('')
    void readFile(file)
  }

  const selectedProviderConnected = provider === 'google_drive' ? googleConnected : oneDriveConnected
  const providerDisabled = disabled || action !== null
  const continueCursor = selectedFile && readOutput ? nextConnectedFileReadCursor(selectedFile, readOutput) : null
  const visibleReadText = readParts.join('\n\n')

  return (
    <div className="cloud-files-view">
      <header className="cloud-files-header">
        <div>
          <span className="eyebrow">Connected accounts</span>
          <h2>Cloud Files</h2>
          <p>Search and read selected files from Google Drive or OneDrive. Each search, next page, and file read asks for approval.</p>
        </div>
        <div className="cloud-files-header-actions">
          {googleConnected && oneDriveConnected ? (
            <label className="cloud-files-provider">
              <span>Source</span>
              <select value={provider} disabled={providerDisabled} onChange={(event) => chooseProvider(event.target.value as ConnectedFileProvider)}>
                {availableProviders.map((item) => <option value={item} key={item}>{providerName(item)}</option>)}
              </select>
            </label>
          ) : (
            <span className="cloud-files-source-badge">{selectedProviderConnected ? providerName(provider) : 'No connected source'}</span>
          )}
          {!googleConnected && <button className="ghost-button" type="button" onClick={onOpenSettings}>Connect Google Drive</button>}
          {!oneDriveConnected && <button className="ghost-button" type="button" onClick={onOpenSettings}>Connect OneDrive</button>}
        </div>
      </header>

      <div className="cloud-files-privacy" role="note">
        <strong>Results stay on this page</strong>
        <span>Searches and reads go to the selected cloud provider after approval. Results and extracted text are not added to Chat or saved in chat history.</span>
      </div>

      {!availableProviders.length ? (
        <section className="cloud-files-connect-empty">
          <span className="eyebrow">Get started</span>
          <h3>Connect a file source</h3>
          <p>Set up Google Drive or OneDrive in Settings. Both connectors are read-only, and each external request requires approval.</p>
          <button className="primary-button" type="button" onClick={onOpenSettings}>Open connection settings</button>
        </section>
      ) : (
        <>
          {selectedProviderConnected ? (
            <form className="cloud-files-search" onSubmit={(event) => { event.preventDefault(); void search() }}>
              <label htmlFor="cloud-files-query">Search names and supported file contents</label>
              <div className="cloud-files-search-row">
                <input
                  id="cloud-files-query"
                  type="search"
                  value={query}
                  maxLength={120}
                  minLength={2}
                  placeholder="e.g. IELTS course plan"
                  disabled={providerDisabled}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <button className="primary-button" type="submit" disabled={providerDisabled || query.trim().length < 2}>
                  {action === 'search' ? 'Waiting for approval…' : 'Search'}
                </button>
              </div>
            </form>
          ) : (
            <div className="cloud-files-disconnected" role="status">
              <p>The selected file service is disconnected. Reconnect it in Settings before searching.</p>
              <button className="ghost-button" type="button" onClick={onOpenSettings}>Open connection settings</button>
            </div>
          )}

          {searchError && <p className="cloud-files-error" role="alert">{searchError}</p>}
          {action === 'search' && <p className="cloud-files-status" role="status">Waiting for your approval, then searching {providerName(provider)}…</p>}

          {selectedProviderConnected && (hasSearched || files.length > 0) && (
            <div className="cloud-files-layout">
              <section className="cloud-files-results" aria-label="Search results">
                <div className="cloud-files-section-head">
                  <div>
                    <h3>Search results</h3>
                    <span>{files.length} file{files.length === 1 ? '' : 's'} · {providerName(provider)}</span>
                  </div>
                  {nextPageToken && provider === 'google_drive' && (
                    <button className="ghost-button" type="button" disabled={providerDisabled} onClick={() => void search(nextPageToken)}>
                      Load more
                    </button>
                  )}
                </div>
                {searchNote && <p className="cloud-files-note">{searchNote}</p>}
                {hasSearched && files.length === 0 ? (
                  <p className="cloud-files-empty">No matching files. Try a broader phrase.</p>
                ) : (
                  <div className="cloud-files-result-list" role="list">
                    {files.map((file) => {
                      const modified = displayDate(file.modifiedTime)
                      const size = displaySize(file.size)
                      return (
                        <div role="listitem" key={file.id}>
                          <button
                            className={`cloud-files-result ${selectedFile?.id === file.id ? 'active' : ''}`}
                            type="button"
                            aria-pressed={selectedFile?.id === file.id}
                            disabled={providerDisabled}
                            onClick={() => changeFile(file)}
                          >
                            <strong>{file.name}</strong>
                            <span>{file.mimeType}</span>
                            {file.parentPath && <span className="cloud-files-path">{file.parentPath}</span>}
                            {(modified || size) && <small>{[modified, size].filter(Boolean).join(' · ')}</small>}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>

              <section className="cloud-files-reader" aria-label="Selected file contents">
                {selectedFile ? (
                  <>
                    <div className="cloud-files-section-head">
                      <div>
                        <h3>{selectedFile.name}</h3>
                        <span>{selectedFile.mimeType} · {providerName(provider)}</span>
                      </div>
                    </div>
                    {action === 'read' && <p className="cloud-files-status" role="status">Waiting for approval, then reading the selected file…</p>}
                    {readError && <p className="cloud-files-error" role="alert">{readError}</p>}
                    {readOutput?.note && <p className="cloud-files-note">{readOutput.note}</p>}
                    {readParts.length > 0 ? (
                      <>
                        <pre className="cloud-files-text">{visibleReadText}</pre>
                        {readOutput?.text.length === 0 && <p className="cloud-files-empty">This file has no extractable text.</p>}
                        {continueCursor && readParts.length < MAX_RETAINED_READ_PARTS && (
                          <button className="ghost-button" type="button" disabled={providerDisabled} onClick={() => void readFile(selectedFile, continueCursor)}>
                            Read next part (asks approval again)
                          </button>
                        )}
                        {continueCursor && readParts.length >= MAX_RETAINED_READ_PARTS && <p className="cloud-files-note">This view has reached its 10-part reading limit. Start a new file read to clear it.</p>}
                      </>
                    ) : !readError && action !== 'read' ? (
                      <p className="cloud-files-empty">Choose Read again to request an approved extract.</p>
                    ) : null}
                    {readError && <button className="ghost-button" type="button" disabled={providerDisabled} onClick={() => void readFile(selectedFile, readParts.length > 0 ? continueCursor ?? undefined : undefined)}>Retry read</button>}
                  </>
                ) : (
                  <div className="cloud-files-reader-empty">
                    <span aria-hidden="true">▤</span>
                    <h3>Choose a file to read</h3>
                    <p>File content is shown here as plain text. It is never executed or interpreted as instructions.</p>
                  </div>
                )}
              </section>
            </div>
          )}

          {selectedProviderConnected && !hasSearched && files.length === 0 && action !== 'search' && !searchError && (
            <div className="cloud-files-first-search">
              <h3>Find a file</h3>
              <p>Search results are limited to 10 per page. Google Drive supports approved pagination; OneDrive returns the first 10 matches.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
