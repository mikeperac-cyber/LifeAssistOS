import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, safeStorage, session, shell, Tray } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BackupRestoreRestartRequiredError,
  createBackupSnapshot,
  recoverInterruptedBackupRestore,
  restoreBackupSnapshot
} from '../core/backup'
import { PlanningStore } from '../core/planning'
import { LifeStore } from '../core/lifeos'
import { readFolderSyncConfig, syncSharedFolder, writeFolderSyncConfig } from '../core/folder-sync'
import { TaskReminderScheduler } from '../core/reminders'
import { createProviderForSettings } from '../core/providers/factory'
import { describeProviderError, ProviderError } from '../core/providers/types'
import { DEFAULT_PROVIDER_SETTINGS, SettingsStore } from '../core/settings'
import type { SecretCodec } from '../core/settings'
import type { AssistEvent, ProviderSettings, ProviderStatus } from '../shared/types'
import type { PublicSettings, SettingsPatch } from '../shared/ipc'
import { providerRequiresApiKey } from '../shared/provider-endpoint'
import type { IpcMainInvokeEvent } from 'electron'
import { SystemTrayManager, shouldMinimizeToTrayOnClose } from './tray'
import { registerDomainIpcHandlers } from './ipc/domain-handlers'
import { registerTodoAiIpcHandlers } from './ipc/todo-ai-handlers'
import { registerAssistantIpcHandlers } from './ipc/assistant-handlers'
import { registerProviderAuthIpcHandlers } from './ipc/provider-auth-handlers'
import { registerLifeIpcHandlers } from './ipc/lifeos-handlers'
import { ProviderRequestGate, ProviderRequestGateError } from './ipc/provider-request-gate'

app.setName('Mike Assist')
nativeTheme.themeSource = 'dark'
if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? 'com.mikeassist.desktop' : process.execPath)

let mainWindow: BrowserWindow | null = null
let systemTray: SystemTrayManager | null = null
let planning: PlanningStore | null = null
let life: LifeStore | null = null
let folderSyncRunning = false
let folderAutoSyncTimer: ReturnType<typeof setInterval> | undefined
let settings: SettingsStore | null = null
let reminders: TaskReminderScheduler | null = null
let isQuitting = false
let providerRequestGate = new ProviderRequestGate()

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

function sendToRenderer(event: AssistEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('assist:event', event)
}

function fallbackSettings(): PublicSettings {
  return {
    provider: { ...DEFAULT_PROVIDER_SETTINGS, hasApiKey: false, apiKeyStored: false, credentialReentryRequired: false, savedCredentials: [] },
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
  providerRequestGate = new ProviderRequestGate(
    undefined,
    undefined,
    undefined,
    undefined,
    path.join(userData, 'ai-request-limits.sqlite')
  )
  try { await providerRequestGate.init() }
  catch (error) { console.warn('[provider-request-gate] durable usage state unavailable; AI requests will stay disabled', error) }

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
  life = new LifeStore(planning.database, planning)
  life.init()
  reminders = new TaskReminderScheduler(planning, deliverReminder)
  registerIpc()
  try { if ((await readFolderSyncConfig(userData)).encryptedPassphrase) startFolderAutoSync() }
  catch (error) { console.warn('[folder-sync] saved sync settings could not be loaded', asErrorMessage(error)) }
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
  const guardedIpcMain = {
    handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void {
      ipcMain.handle(channel, (event, ...args) => {
        if (!isTrustedRenderer(event)) throw new Error('This request did not come from the Mike Assist window.')
        return listener(event, ...args)
      })
    }
  } as Pick<typeof ipcMain, 'handle'>

  registerDomainIpcHandlers({
    ipcMain: guardedIpcMain,
    getPlanning: () => planning,
    sendEvent: sendToRenderer,
    errorMessage: asErrorMessage
  })

  registerLifeIpcHandlers({
    ipcMain: guardedIpcMain,
    getLife: () => life,
    sendEvent: sendToRenderer,
    errorMessage: asErrorMessage
  })

  registerTodoAiIpcHandlers({
    ipcMain: guardedIpcMain,
    getProviderSettings,
    requestGate: providerRequestGate,
    createProvider: (providerSettings, role) => createProviderForSettings(providerSettings, role)
  })

  registerAssistantIpcHandlers({
    ipcMain: guardedIpcMain,
    sendDelta: (event, requestId, text) => event.sender.send('assist:assistant-delta', { requestId, text }),
    getProviderSettings,
    requestGate: providerRequestGate,
    getTasks: () => planning?.listAssistantTasks() ?? [],
    getLifeContext: () => ({
      goals: life?.workspace().goals.map(({ title, description, status, targetDate }) => ({ title, description, status, targetDate })) ?? [],
      journal: life?.listJournal().slice(0, 10).map(({ entryDate, title, content }) => ({ entryDate, title, content: content.slice(0, 1200) })) ?? [],
      ...(life?.getPersonalContext() ?? { aboutMe: '', preferences: '', currentFocus: '', updatedAt: '' })
    }),
    createProvider: (providerSettings, role) => createProviderForSettings(providerSettings, role)
  })

  registerProviderAuthIpcHandlers({
    ipcMain: guardedIpcMain,
    getSettings: () => settings,
    openExternal: (url) => shell.openExternal(url)
  })

  guardedIpcMain.handle('assist:settings', () => settings?.public() ?? fallbackSettings())
  guardedIpcMain.handle('assist:settings-update', async (_event, raw: unknown) => {
    if (!settings) return { ok: false, error: 'Mike Assist is still starting.' }
    if (!isRecord(raw)) return { ok: false, error: 'Invalid settings.' }
    try {
      await settings.update(raw as SettingsPatch)
      return { ok: true, settings: settings.public() }
    } catch (error) { return { ok: false, error: asErrorMessage(error) } }
  })
  guardedIpcMain.handle('assist:provider-credential-remove', async (_event, raw: unknown) => {
    if (!settings) return { ok: false, error: 'Mike Assist is still starting.' }
    if (!isRecord(raw) || Object.keys(raw).length !== 2 || typeof raw['preset'] !== 'string' || typeof raw['baseUrl'] !== 'string') {
      return { ok: false, error: 'Invalid provider connection.' }
    }
    try {
      await settings.removeProviderApiKey({ preset: raw['preset'] as ProviderSettings['preset'], baseUrl: raw['baseUrl'] })
      return { ok: true, settings: settings.public() }
    } catch (error) { return { ok: false, error: asErrorMessage(error) } }
  })
  guardedIpcMain.handle('assist:provider-test', async () => {
    try { return await providerRequestGate.run(testProvider) }
    catch (error) {
      return { ok: false, message: error instanceof ProviderRequestGateError ? error.message : 'Provider test is unavailable. Try again shortly.' }
    }
  })
  guardedIpcMain.handle('assist:backup', (_event, passphrase: unknown) => createBackup(passphrase))
  guardedIpcMain.handle('assist:backup-restore', (_event, passphrase: unknown) => restoreBackup(passphrase))
  guardedIpcMain.handle('assist:folder-sync-config', async () => {
    try {
      const config = await readFolderSyncConfig(app.getPath('userData'))
      return { ok: true, folderPath: config.folderPath, passphraseSaved: Boolean(config.encryptedPassphrase), secureStorageAvailable: await safeStorage.isAsyncEncryptionAvailable() }
    }
    catch (error) { return { ok: false, error: asErrorMessage(error) } }
  })
  guardedIpcMain.handle('assist:folder-sync-choose', async () => {
    try {
      const selection = mainWindow
        ? await dialog.showOpenDialog(mainWindow, { title: 'Choose a cloud-synced folder for Mike Assist', buttonLabel: 'Use this folder', properties: ['openDirectory', 'createDirectory'] })
        : await dialog.showOpenDialog({ title: 'Choose a cloud-synced folder for Mike Assist', buttonLabel: 'Use this folder', properties: ['openDirectory', 'createDirectory'] })
      if (selection.canceled || !selection.filePaths[0]) return { ok: false, cancelled: true }
      const current = await readFolderSyncConfig(app.getPath('userData'))
      await writeFolderSyncConfig(app.getPath('userData'), { ...current, folderPath: path.resolve(selection.filePaths[0]) })
      return { ok: true, folderPath: path.resolve(selection.filePaths[0]) }
    } catch (error) { return { ok: false, error: asErrorMessage(error) } }
  })
  guardedIpcMain.handle('assist:folder-sync-forget-passphrase', async () => {
    if (folderSyncRunning) return { ok: false, error: 'Workspace data is busy. Try again shortly.' }
    folderSyncRunning = true
    try {
      const config = await readFolderSyncConfig(app.getPath('userData'))
      const { encryptedPassphrase: _discarded, ...withoutPassphrase } = config
      await writeFolderSyncConfig(app.getPath('userData'), withoutPassphrase)
      stopFolderAutoSync()
      return { ok: true, folderPath: config.folderPath, passphraseSaved: false, secureStorageAvailable: await safeStorage.isAsyncEncryptionAvailable() }
    } catch (error) { return { ok: false, error: asErrorMessage(error) } }
    finally { folderSyncRunning = false }
  })
  guardedIpcMain.handle('assist:folder-sync', async (_event, raw: unknown) => {
    if (folderSyncRunning) return { ok: false, error: 'A sync is already running.' }
    if (!planning || !isRecord(raw) || typeof raw['passphrase'] !== 'string' || typeof raw['rememberPassphrase'] !== 'boolean') return { ok: false, error: 'Enter your sync passphrase to continue.' }
    folderSyncRunning = true
    try {
      const config = await readFolderSyncConfig(app.getPath('userData'))
      if (!config.folderPath) return { ok: false, error: 'Choose a shared sync folder first.' }
      let passphrase = raw['passphrase']
      if (!passphrase && config.encryptedPassphrase) {
        if (!await safeStorage.isAsyncEncryptionAvailable()) return { ok: false, error: 'Windows secure storage is unavailable. Enter the passphrase again to sync.' }
        try { passphrase = (await safeStorage.decryptStringAsync(Buffer.from(config.encryptedPassphrase, 'base64'))).result }
        catch { return { ok: false, error: 'The saved sync passphrase could not be unlocked. Enter it again.' } }
      }
      if (passphrase.length < 12 || passphrase.length > 1024) return { ok: false, error: 'Use a sync passphrase with at least 12 characters.' }
      if (raw['rememberPassphrase'] && !await safeStorage.isAsyncEncryptionAvailable()) return { ok: false, error: 'Windows secure storage is unavailable, so Mike Assist cannot remember this passphrase safely.' }
      let encryptedPassphrase: string | undefined
      if (raw['rememberPassphrase']) encryptedPassphrase = (await safeStorage.encryptStringAsync(passphrase)).toString('base64')
      const result = await syncSharedFolder(planning.database, config.folderPath, config.deviceId, passphrase)
      if (raw['rememberPassphrase']) await writeFolderSyncConfig(app.getPath('userData'), { ...config, encryptedPassphrase })
      else if (config.encryptedPassphrase) {
        const { encryptedPassphrase: _discarded, ...withoutPassphrase } = config
        await writeFolderSyncConfig(app.getPath('userData'), withoutPassphrase)
      }
      if (result.changed) sendToRenderer({ type: 'today_changed' })
      if (raw['rememberPassphrase']) startFolderAutoSync()
      else stopFolderAutoSync()
      return { ok: true, ...result }
    } catch (error) { return { ok: false, error: asErrorMessage(error) } }
    finally { folderSyncRunning = false }
  })
}

function startFolderAutoSync(): void {
  if (folderAutoSyncTimer) return
  const run = (): void => { void runFolderAutoSync() }
  folderAutoSyncTimer = setInterval(run, 90_000)
  folderAutoSyncTimer.unref?.()
  const warmup = setTimeout(run, 15_000)
  warmup.unref?.()
}

function stopFolderAutoSync(): void {
  if (folderAutoSyncTimer) clearInterval(folderAutoSyncTimer)
  folderAutoSyncTimer = undefined
}

async function runFolderAutoSync(): Promise<void> {
  if (folderSyncRunning || !planning || !await safeStorage.isAsyncEncryptionAvailable()) return
  folderSyncRunning = true
  try {
    const config = await readFolderSyncConfig(app.getPath('userData'))
    if (!config.folderPath || !config.encryptedPassphrase) return
    const passphrase = (await safeStorage.decryptStringAsync(Buffer.from(config.encryptedPassphrase, 'base64'))).result
    const result = await syncSharedFolder(planning.database, config.folderPath, config.deviceId, passphrase)
    if (result.changed) sendToRenderer({ type: 'today_changed' })
  } catch (error) { console.warn('[folder-sync] automatic sync did not complete', asErrorMessage(error)) }
  finally { folderSyncRunning = false }
}

function isTrustedRenderer(event: IpcMainInvokeEvent): boolean {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents || event.senderFrame !== event.sender.mainFrame) return false
  const expectedDevUrl = process.env['ELECTRON_RENDERER_URL']
  try {
    const actual = new URL(event.senderFrame.url)
    if (expectedDevUrl) {
      const expected = new URL(expectedDevUrl)
      return actual.origin === expected.origin && actual.pathname === expected.pathname
    }
    return actual.protocol === 'file:' && path.resolve(fileURLToPath(actual)) === path.resolve(path.join(__dirname, '../renderer/index.html'))
  } catch { return false }
}

async function testProvider(): Promise<ProviderStatus> {
  if (!settings) return { ok: false, message: 'Settings are not loaded yet.' }
  try {
    const providerSettings = settings.get().provider
    if (providerRequiresApiKey(providerSettings.preset, providerSettings.baseUrl) && !providerSettings.apiKey?.trim()) {
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

async function createBackup(passphrase: unknown): Promise<{ ok: boolean; cancelled?: boolean; error?: string; folderName?: string }> {
  if (!planning || !settings) return { ok: false, error: 'Backup services are not ready.' }
  if (passphrase !== undefined && typeof passphrase !== 'string') return { ok: false, error: 'Invalid backup passphrase.' }
  const selection = mainWindow
    ? await dialog.showOpenDialog(mainWindow, { title: 'Choose where to create a Mike Assist backup', buttonLabel: 'Choose backup location', properties: ['openDirectory', 'createDirectory'] })
    : await dialog.showOpenDialog({ title: 'Choose where to create a Mike Assist backup', buttonLabel: 'Choose backup location', properties: ['openDirectory', 'createDirectory'] })
  if (selection.canceled || !selection.filePaths[0]) return { ok: false, cancelled: true }

  const folderName = `Mike Assist Backup ${new Date().toISOString().replace(/[:.]/g, '-')}`
  const backupPath = path.resolve(selection.filePaths[0], folderName)
  if (folderSyncRunning) return { ok: false, error: 'Workspace data is busy. Try the backup again shortly.' }
  folderSyncRunning = true
  try {
    await createBackupSnapshot(app.getPath('userData'), backupPath, planning, app.getVersion(), {
      settingsFile: path.join(app.getPath('userData'), 'settings.json'),
      passphrase: typeof passphrase === 'string' ? passphrase : undefined
    })
    return { ok: true, folderName }
  } catch (error) { return { ok: false, error: asErrorMessage(error) } }
  finally { folderSyncRunning = false }
}

async function restoreBackup(passphrase: unknown): Promise<{ ok: boolean; cancelled?: boolean; error?: string; folderName?: string }> {
  if (!planning || !settings) return { ok: false, error: 'Backup services are not ready.' }
  if (folderSyncRunning) return { ok: false, error: 'Workspace data is busy. Try the restore again shortly.' }
  if (passphrase !== undefined && typeof passphrase !== 'string') return { ok: false, error: 'Invalid backup passphrase.' }
  const selection = mainWindow
    ? await dialog.showOpenDialog(mainWindow, { title: 'Choose a Mike Assist backup folder', buttonLabel: 'Restore this backup', properties: ['openDirectory'] })
    : await dialog.showOpenDialog({ title: 'Choose a Mike Assist backup folder', buttonLabel: 'Restore this backup', properties: ['openDirectory'] })
  if (selection.canceled || !selection.filePaths[0]) return { ok: false, cancelled: true }
  if (folderSyncRunning) return { ok: false, error: 'Workspace data is busy. Try the restore again shortly.' }

  const backupPath = path.resolve(selection.filePaths[0])
  folderSyncRunning = true
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
    folderSyncRunning = false
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
  stopFolderAutoSync()
  reminders?.stop()
  planning?.close()
})

app.on('window-all-closed', () => {
  if (settings?.get().provider.keepInBackground && !isQuitting) return
  if (process.platform !== 'darwin') app.quit()
})
