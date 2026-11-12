import type { IpcMain } from 'electron'
import type { SettingsStore } from '../../core/settings'
import { OpenRouterOAuth } from '../../core/openrouter-oauth'
import type { ProviderAuthResult } from '../../shared/ipc'

export interface ProviderAuthIpcContext {
  ipcMain: Pick<IpcMain, 'handle'>
  getSettings: () => SettingsStore | null
  openExternal: (url: string) => Promise<void>
}

const openRouterOAuth = new OpenRouterOAuth()

export function registerProviderAuthIpcHandlers(context: ProviderAuthIpcContext): void {
  context.ipcMain.handle('assist:openrouter-sign-in', async (): Promise<ProviderAuthResult> => {
    const settings = context.getSettings()
    if (!settings) return { ok: false, error: 'LifeAssistOS is still starting. Try again in a moment.' }
    let storedSecurely = false
    const result = await openRouterOAuth.connect(
      context.openExternal,
      async (apiKey) => {
        storedSecurely = await settings.saveProviderApiKey({ preset: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' }, apiKey)
      }
    )
    return result.ok
      ? { ok: true, settings: settings.public(), storedSecurely }
      : { ok: false, error: result.error ?? 'OpenRouter sign-in could not be completed.' }
  })

  context.ipcMain.handle('assist:openrouter-sign-in-cancel', () => openRouterOAuth.cancel())
}
