import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { DOCUMENT_ALLOWED_EXTENSIONS, type DocumentLibraryStore } from '../../core/documents'

type DocumentIpcContext = {
  ipcMain: Pick<typeof ipcMain, 'handle'>
  getStore: () => DocumentLibraryStore | null
  getWindow: () => BrowserWindow | null
}

export function registerDocumentIpcHandlers(context: DocumentIpcContext): void {
  context.ipcMain.handle('assist:documents-list', async () => {
    try {
      const store = context.getStore()
      if (!store) return { ok: false, error: 'The document library is still starting.' }
      return { ok: true, documents: await store.list() }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'The local document library could not be read.' }
    }
  })

  context.ipcMain.handle('assist:documents-add', async () => {
    try {
      const mainWindow = context.getWindow()
      const selection = mainWindow
        ? await dialog.showOpenDialog(mainWindow, { title: 'Add local documents', buttonLabel: 'Add to library', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Documents and images', extensions: [...DOCUMENT_ALLOWED_EXTENSIONS] }] })
        : await dialog.showOpenDialog({ title: 'Add local documents', buttonLabel: 'Add to library', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Documents and images', extensions: [...DOCUMENT_ALLOWED_EXTENSIONS] }] })
      if (selection.canceled) return { ok: true, cancelled: true, documents: [] }
      const store = context.getStore()
      if (!store) return { ok: false, error: 'The document library is still starting.' }
      return { ok: true, documents: await store.addSelectedPaths(selection.filePaths) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Could not add those files.' }
    }
  })

  context.ipcMain.handle('assist:documents-open', async (_event, rawId: unknown) => {
    if (typeof rawId !== 'string') return { ok: false, error: 'Choose a document from the library.' }
    const selectedPath = await context.getStore()?.getExistingPath(rawId)
    if (!selectedPath) return { ok: false, error: 'This file is no longer available at its saved location.' }
    try {
      const result = await shell.openPath(selectedPath)
      return result ? { ok: false, error: 'Windows could not open this file.' } : { ok: true }
    } catch {
      return { ok: false, error: 'Windows could not open this file.' }
    }
  })

  context.ipcMain.handle('assist:documents-reveal', async (_event, rawId: unknown) => {
    if (typeof rawId !== 'string') return { ok: false, error: 'Choose a document from the library.' }
    const selectedPath = await context.getStore()?.getExistingPath(rawId)
    if (!selectedPath) return { ok: false, error: 'This file is no longer available at its saved location.' }
    try {
      shell.showItemInFolder(selectedPath)
      return { ok: true }
    } catch {
      return { ok: false, error: 'Could not show this file in its folder.' }
    }
  })

  context.ipcMain.handle('assist:documents-remove', async (_event, rawId: unknown) => {
    if (typeof rawId !== 'string') return { ok: false, error: 'Choose a document from the library.' }
    try {
      const removed = await context.getStore()?.remove(rawId)
      return removed ? { ok: true } : { ok: false, error: 'That document is no longer in the library.' }
    } catch {
      return { ok: false, error: 'Could not remove the document from this library.' }
    }
  })
}
