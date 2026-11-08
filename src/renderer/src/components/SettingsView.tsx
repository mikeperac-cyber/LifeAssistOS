import { useState } from 'react'
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
          <p>Choose a comfortable color theme for the task workspace.</p>
        </div>
        <label className="field field-wide">
          <span className="field-label">Theme</span>
          <select value={theme} onChange={(event) => onThemeChange(event.target.value as AppTheme)}>
            {APP_THEMES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          <span className="field-hint">{APP_THEMES.find((option) => option.id === theme)?.description}</span>
        </label>
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
    </div>
  )
}
