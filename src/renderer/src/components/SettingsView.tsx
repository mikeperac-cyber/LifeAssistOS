import { useEffect, useState } from 'react'
import type { PublicSettings } from '../../../shared/ipc'
import { APP_THEMES, type AppTheme } from '../theme'
import { ProviderSettingsPanel } from './ProviderSettingsPanel'

export function SettingsView({
  settings,
  onSettingsUpdated,
  theme,
  onThemeChange
}: {
  settings: PublicSettings
  onSettingsUpdated: (settings: PublicSettings) => void
  theme: AppTheme
  onThemeChange: (theme: AppTheme) => void
}): React.JSX.Element {
  const [backupPassphrase, setBackupPassphrase] = useState('')
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupMessage, setBackupMessage] = useState('')
  const [backupError, setBackupError] = useState(false)
  const [syncFolder, setSyncFolder] = useState<string | null>(null)
  const [syncPassphraseSaved, setSyncPassphraseSaved] = useState(false)
  const [secureStorageAvailable, setSecureStorageAvailable] = useState(false)
  const [rememberSyncPassphrase, setRememberSyncPassphrase] = useState(false)
  const [syncLoaded, setSyncLoaded] = useState(false)
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncPassphrase, setSyncPassphrase] = useState('')
  const [syncMessage, setSyncMessage] = useState('')
  const [syncError, setSyncError] = useState(false)

  useEffect(() => {
    void window.assist.getFolderSyncConfig().then((result) => {
      if (result.ok) setSyncFolder(result.folderPath ?? null)
      if (result.ok) { setSyncPassphraseSaved(Boolean(result.passphraseSaved)); setRememberSyncPassphrase(Boolean(result.passphraseSaved)); setSecureStorageAvailable(Boolean(result.secureStorageAvailable)) }
      else { setSyncError(true); setSyncMessage(result.error ?? 'Folder sync settings could not be loaded.') }
      setSyncLoaded(true)
    }).catch((error) => { setSyncError(true); setSyncMessage(error instanceof Error ? error.message : String(error)); setSyncLoaded(true) })
  }, [])

  async function chooseSyncFolder(): Promise<void> {
    setSyncBusy(true); setSyncMessage(''); setSyncError(false)
    try {
      const result = await window.assist.chooseFolderSync()
      if (!result.ok) {
        if (!result.cancelled) { setSyncError(true); setSyncMessage(result.error ?? 'Could not select a sync folder.') }
      } else { setSyncFolder(result.folderPath ?? null); setSyncMessage('Folder saved on this device.') }
    } catch (error) { setSyncError(true); setSyncMessage(error instanceof Error ? error.message : String(error)) }
    finally { setSyncBusy(false) }
  }

  async function syncFolderNow(): Promise<void> {
    setSyncBusy(true); setSyncMessage(''); setSyncError(false)
    try {
      const result = await window.assist.syncFolderSync(syncPassphrase, rememberSyncPassphrase)
      if (!result.ok) { setSyncError(true); setSyncMessage(result.error ?? 'Could not sync this workspace.') }
      else { setSyncPassphraseSaved(rememberSyncPassphrase); setSyncMessage(`Synced ${result.recordCount ?? 0} records with ${result.peerCount ?? 0} other device${result.peerCount === 1 ? '' : 's'}.`) }
    } catch (error) { setSyncError(true); setSyncMessage(error instanceof Error ? error.message : String(error)) }
    finally { setSyncPassphrase(''); setSyncBusy(false) }
  }

  async function forgetSyncPassphrase(): Promise<void> {
    setSyncBusy(true); setSyncMessage(''); setSyncError(false)
    try {
      const result = await window.assist.forgetFolderSyncPassphrase()
      if (!result.ok) { setSyncError(true); setSyncMessage(result.error ?? 'Could not forget the saved passphrase.') }
      else { setSyncPassphraseSaved(false); setRememberSyncPassphrase(false); setSyncMessage('Saved passphrase removed from this device.') }
    } catch (error) { setSyncError(true); setSyncMessage(error instanceof Error ? error.message : String(error)) }
    finally { setSyncBusy(false) }
  }

  async function backup(restore: boolean): Promise<void> {
    setBackupBusy(true)
    setBackupMessage('')
    setBackupError(false)
    try {
      const result = restore
        ? await window.assist.restoreBackup(backupPassphrase || undefined)
        : await window.assist.createBackup(backupPassphrase || undefined)
      if (!result.ok) {
        if (!result.cancelled) {
          setBackupError(true)
          setBackupMessage(result.error ?? (restore ? 'Could not restore this backup.' : 'Could not create a backup.'))
        }
        return
      }
      setBackupMessage(restore ? 'Backup restored. Reloading your local data…' : `Backup saved${result.folderName ? ` to ${result.folderName}` : ''}.`)
      if (restore) window.setTimeout(() => window.location.reload(), 250)
    } catch (error) {
      setBackupError(true)
      setBackupMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBackupBusy(false)
    }
  }

  return (
    <div className="settings-view">
      <ProviderSettingsPanel settings={settings} onSettingsUpdated={onSettingsUpdated} />

      <section className="settings-section" aria-labelledby="appearance-settings-title">
        <div className="section-head">
          <h2 id="appearance-settings-title">Appearance</h2>
          <p>Choose the color of your workspace. Your choice is saved on this device.</p>
        </div>
        <fieldset className="theme-options" aria-label="Workspace appearance">
          <legend className="sr-only">Choose an appearance</legend>
          {APP_THEMES.map((option) => (
            <label className={`theme-option${theme === option.id ? ' selected' : ''}`} key={option.id}>
              <input
                type="radio"
                name="app-theme"
                value={option.id}
                checked={theme === option.id}
                onChange={() => onThemeChange(option.id)}
              />
              <span className={`theme-swatch theme-swatch-${option.id}`} aria-hidden="true">
                <span className="theme-swatch-sidebar" />
                <span className="theme-swatch-main"><span /><span /><span /></span>
              </span>
              <span className="theme-option-copy">
                <strong>{option.label}</strong>
                <span>{option.description}</span>
              </span>
              <span className="theme-option-check">{theme === option.id ? 'Selected' : ''}</span>
            </label>
          ))}
        </fieldset>
      </section>

      <section className="settings-section" aria-labelledby="backup-settings-title">
        <div className="section-head">
          <h2 id="backup-settings-title">Local backup &amp; restore</h2>
          <p>Create a backup of your local task data and settings, or restore a previous backup. An optional passphrase encrypts the backup.</p>
        </div>
        <label className="field field-wide">
          <span className="field-label">Encryption passphrase (optional)</span>
          <input type="password" value={backupPassphrase} onChange={(event) => setBackupPassphrase(event.target.value)} autoComplete="new-password" />
        </label>
        <div className="settings-actions">
          <button className="ghost-button" type="button" onClick={() => void backup(false)} disabled={backupBusy}>{backupBusy ? 'Working…' : 'Create backup…'}</button>
          <button className="ghost-button" type="button" onClick={() => void backup(true)} disabled={backupBusy}>{backupBusy ? 'Working…' : 'Restore backup…'}</button>
          {backupMessage && <span className={`settings-status ${backupError ? 'status-error' : 'status-ok'}`} role={backupError ? 'alert' : 'status'}>{backupMessage}</span>}
        </div>
      </section>

      <section className="settings-section" aria-labelledby="folder-sync-title">
        <div className="section-head">
          <h2 id="folder-sync-title">Encrypted folder sync</h2>
          <p>Use the same cloud-synced folder and passphrase on each device. Mike Assist encrypts workspace records before writing per-device snapshots; edits from offline devices merge the next time you sync. The newest saved version wins if the same record changed on two devices.</p>
        </div>
        <div className="folder-sync-location">
          <div><strong>Shared folder</strong><span>{syncLoaded ? syncFolder ?? 'No folder selected' : 'Loading sync settings…'}</span></div>
          <button className="ghost-button" type="button" onClick={() => void chooseSyncFolder()} disabled={syncBusy}>{syncFolder ? 'Change folder…' : 'Choose folder…'}</button>
        </div>
        <label className="field field-wide">
          <span className="field-label">Sync passphrase{syncPassphraseSaved && !syncPassphrase ? ' · saved securely on this device' : ''}</span>
          <input type="password" value={syncPassphrase} onChange={(event) => setSyncPassphrase(event.target.value)} autoComplete="new-password" minLength={12} maxLength={1024} />
        </label>
        <label className="folder-sync-remember"><input type="checkbox" checked={rememberSyncPassphrase} disabled={!secureStorageAvailable || syncBusy} onChange={(event) => setRememberSyncPassphrase(event.target.checked)} /><span>Remember on this device using Windows secure storage</span></label>
        <p className="folder-sync-help">Use at least 12 characters. Keep the same phrase on every device. Sync after your cloud storage has finished updating the shared folder. Remembering the phrase enables automatic sync while Mike Assist is running. API keys and appearance settings stay on this device.</p>
        <div className="settings-actions">
          <button className="primary-button" type="button" onClick={() => void syncFolderNow()} disabled={syncBusy || !syncFolder || (syncPassphrase.length < 12 && !(syncPassphraseSaved && !syncPassphrase))}>{syncBusy ? 'Syncing…' : 'Sync now'}</button>
          {syncPassphraseSaved && <button className="ghost-button" type="button" onClick={() => void forgetSyncPassphrase()} disabled={syncBusy}>Forget saved passphrase</button>}
          {syncMessage && <span className={`settings-status ${syncError ? 'status-error' : 'status-ok'}`} role={syncError ? 'alert' : 'status'}>{syncMessage}</span>}
        </div>
      </section>
    </div>
  )
}
