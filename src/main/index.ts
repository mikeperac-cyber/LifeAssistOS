import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, safeStorage, session, shell, Tray } from 'electron'
import path from 'node:path'
import {
  BackupRestoreRestartRequiredError,
  createBackupSnapshot,
  recoverInterruptedBackupRestore,
  restoreBackupSnapshot
} from '../core/backup'
import { PlanningStore } from '../core/planning'
import { TaskReminderScheduler } from '../core/reminders'
import { createProviderForSettings } from '../core/providers/factory'
import { describeProviderError, ProviderError } from '../core/providers/types'
import { DEFAULT_PROVIDER_SETTINGS, SettingsStore } from '../core/settings'
import type { SecretCodec } from '../core/settings'
import type { AssistEvent, ProviderSettings, ProviderStatus } from '../shared/types'
import type { PublicSettings, SettingsPatch } from '../shared/ipc'
import { SystemTrayManager, shouldMinimizeToTrayOnClose } from './tray'
import { registerDomainIpcHandlers } from './ipc/domain-handlers'
import { registerTodoAiIpcHandlers } from './ipc/todo-ai-handlers'

app.setName('Mike Assist')
nativeTheme.themeSource = 'dark'
if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? 'com.mikeassist.desktop' : process.execPath)

let mainWindow: BrowserWindow | null = null
let systemTray: SystemTrayManager | null = null
let planning: PlanningStore | null = null
let settings: SettingsStore | null = null
let reminders: TaskReminderScheduler | null = null
let isQuitting = false

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

function sendToRenderer(event: AssistEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('assist:event', event)
}

function fallbackSettings(): PublicSettings {
  return {
    provider: { ...DEFAULT_PROVIDER_SETTINGS, hasApiKey: false, apiKeyStored: false },
    onboardingComplete: false
  }
}

function getProviderSettings(): ProviderSettings | null {
  return settings?.get().provider ?? null
}

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred.'
}

async function initialize(): Promise<void> {
  const userData = app.getPath('userData')
  await recoverInterruptedBackupRestore(userData)

  const codec: SecretCodec = {
    available: await safeStorage.isAsyncEncryptionAvailable(),
    encrypt: async (value) => (await safeStorage.encryptStringAsync(value)).toString('base64'),
    decrypt: async (value) => {
      const result = await safeStorage.decryptStringAsync(Buffer.from(value, 'base64'))
      return { value: result.result, shouldReEncrypt: result.shouldReEncrypt }
    }
  }

  settings = new SettingsStore(path.join(userData, 'settings.json'), codec)
  await settings.init()
  planning = new PlanningStore(path.join(userData, 'planning.sqlite'))
  await planning.init()
  reminders = new TaskReminderScheduler(planning, deliverReminder)
  registerIpc()
}

function deliverReminder(reminder: { id: string; title: string }): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({ title: 'Mike Assist reminder', body: reminder.title })
  notification.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow()
    else { mainWindow.show(); mainWindow.focus() }
    sendToRenderer({ type: 'today_changed' })
  })
  notification.show()
}

function registerIpc(): void {
  registerDomainIpcHandlers({
    ipcMain,
    getPlanning: () => planning,
    sendEvent: sendToRenderer,
    errorMessage: asErrorMessage
  })

  registerTodoAiIpcHandlers({
    ipcMain,
    getProviderSettings,
    createProvider: (providerSettings, role) => createProviderForSettings(providerSettings, role)
  })

  ipcMain.handle('assist:settings', () => settings?.public() ?? fallbackSettings())
  ipcMain.handle('assist:settings-update', async (_event, raw: unknown) => {
    if (!settings) return { ok: false, error: 'Mike Assist is still starting.' }
    if (!isRecord(raw)) return { ok: false, error: 'Invalid settings.' }
    try {
      await settings.update(raw as SettingsPatch)
      return { ok: true, settings: settings.public() }
    } catch (error) { return { ok: false, error: asErrorMessage(error) } }
  })
  ipcMain.handle('assist:provider-test', () => testProvider())
  ipcMain.handle('assist:backup', (_event, passphrase: unknown) => createBackup(passphrase))
  ipcMain.handle('assist:backup-restore', (_event, passphrase: unknown) => restoreBackup(passphrase))
}

async function testProvider(): Promise<ProviderStatus> {
  if (!settings) return { ok: false, message: 'Settings are not loaded yet.' }
  try {
    const providerSettings = settings.get().provider
    if (requiresKey(providerSettings) && !providerSettings.apiKey?.trim()) {
      return { ok: false, message: 'Add your provider API key in Settings, then test the connection.' }
    }
    const models = await createProviderForSettings(providerSettings).listModels()
    const note = models.includes(providerSettings.model) ? '' : ` The selected model “${providerSettings.model}” was not listed.`
    return { ok: true, message: `Connected. ${models.length} model${models.length === 1 ? '' : 's'} available.${note}`, models }
  } catch (error) {
    const message = error instanceof ProviderError
      ? describeProviderError(error)
      : 'The provider could not be reached. Check the endpoint and try again.'
    return { ok: false, message }
  }
}

function requiresKey(provider: ProviderSettings): boolean {
  if (provider.preset === 'ollama' || provider.preset === 'lmstudio') return false
  try {
    const hostname = new URL(provider.baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '')
    return hostname !== 'localhost' && !hostname.endsWith('.localhost') && hostname !== '127.0.0.1' && hostname !== '::1'
  } catch { return true }
}

async function createBackup(passphrase: unknown): Promise<{ ok: boolean; cancelled?: boolean; error?: string; folderName?: string }> {
  if (!planning || !settings) return { ok: false, error: 'Backup services are not ready.' }
  if (passphrase !== undefined && typeof passphrase !== 'string') return { ok: false, error: 'Invalid backup passphrase.' }
  const selection = mainWindow
    ? await dialog.showOpenDialog(mainWindow, { title: 'Choose where to create a Mike Assist backup', buttonLabel: 'Choose backup location', properties: ['openDirectory', 'createDirectory'] })
    : await dialog.showOpenDialog({ title: 'Choose where to create a Mike Assist backup', buttonLabel: 'Choose backup location', properties: ['openDirectory', 'createDirectory'] })
  if (selection.canceled || !selection.filePaths[0]) return { ok: false, cancelled: true }

  const folderName = `Mike Assist Backup ${new Date().toISOString().replace(/[:.]/g, '-')}`
  const backupPath = path.resolve(selection.filePaths[0], folderName)
  try {
    await createBackupSnapshot(app.getPath('userData'), backupPath, planning, app.getVersion(), {
      settingsFile: path.join(app.getPath('userData'), 'settings.json'),
      passphrase: typeof passphrase === 'string' ? passphrase : undefined
    })
    return { ok: true, folderName }
  } catch (error) { return { ok: false, error: asErrorMessage(error) } }
}

async function restoreBackup(passphrase: unknown): Promise<{ ok: boolean; cancelled?: boolean; error?: string; folderName?: string }> {
  if (!planning || !settings) return { ok: false, error: 'Backup services are not ready.' }
  if (passphrase !== undefined && typeof passphrase !== 'string') return { ok: false, error: 'Invalid backup passphrase.' }
  const selection = mainWindow
    ? await dialog.showOpenDialog(mainWindow, { title: 'Choose a Mike Assist backup folder', buttonLabel: 'Restore this backup', properties: ['openDirectory'] })
    : await dialog.showOpenDialog({ title: 'Choose a Mike Assist backup folder', buttonLabel: 'Restore this backup', properties: ['openDirectory'] })
  if (selection.canceled || !selection.filePaths[0]) return { ok: false, cancelled: true }

  const backupPath = path.resolve(selection.filePaths[0])
  let restartRequired = false
  const wasEnabled = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isEnabled())
  try {
    reminders?.stop()
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setEnabled(false)
    const result = await restoreBackupSnapshot(backupPath, app.getPath('userData'), {
      passphrase: typeof passphrase === 'string' ? passphrase : undefined,
      closeStores: () => planning?.close(),
      reopenStores: async () => {
        await planning?.init()
        await settings?.init()
      }
    })
    return { ok: true, folderName: path.basename(backupPath), ...result }
  } catch (error) {
    restartRequired = error instanceof BackupRestoreRestartRequiredError
    return { ok: false, error: asErrorMessage(error) }
  } finally {
    if (restartRequired) {
      setTimeout(() => { app.relaunch(); app.exit(0) }, 1_000)
    } else {
      reminders?.start()
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setEnabled(wasEnabled)
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 880,
    minHeight: 620,
    show: false,
    backgroundColor: '#090c12',
    title: 'Mike Assist',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('close', (event) => {
    if (!shouldMinimizeToTrayOnClose({ keepInBackground: settings?.get().provider.keepInBackground, isQuitting })) return
    if (!systemTray) systemTray = new SystemTrayManager({
      Tray, Menu, nativeImage,
      iconPath: app.isPackaged ? path.join(process.resourcesPath, 'app-icon.png') : path.join(app.getAppPath(), 'resources', 'app-icon.png'),
      onOpenWindow: () => {
        if (!mainWindow || mainWindow.isDestroyed()) createWindow()
        else { mainWindow.show(); mainWindow.focus() }
      },
      onQuickCapture: () => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          createWindow()
          mainWindow?.once('ready-to-show', () => sendToRenderer({ type: 'quick_capture_requested' }))
        } else {
          mainWindow.show()
          mainWindow.focus()
          sendToRenderer({ type: 'quick_capture_requested' })
        }
      },
      onQuitApp: () => { isQuitting = true; app.quit() }
    })
    if (systemTray.ensureCreated()) { event.preventDefault(); mainWindow?.hide() }
  })
  mainWindow.on('closed', () => { mainWindow = null })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url)
      if (target.protocol === 'https:' || target.protocol === 'http:') void shell.openExternal(target.toString())
    } catch { /* Ignore malformed external URLs. */ }
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault())
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void mainWindow.loadURL(devUrl)
  else void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
}

if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow()
    else { mainWindow.show(); mainWindow.focus() }
  })

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)
    if (!process.env['ELECTRON_RENDERER_URL']) {
      session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'"]
        }
      }))
    }
    try {
      await initialize()
      reminders?.start()
      createWindow()
    } catch (error) {
      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
      dialog.showErrorBox('Mike Assist could not start', detail)
      app.quit()
    }
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  })
}

app.on('before-quit', () => {
  isQuitting = true
  systemTray?.dispose()
  reminders?.stop()
  planning?.close()
})

app.on('window-all-closed', () => {
  if (settings?.get().provider.keepInBackground && !isQuitting) return
  if (process.platform !== 'darwin') app.quit()
})
