import type { Menu as ElectronMenu, Tray as ElectronTray, nativeImage as ElectronNativeImage } from 'electron'

export function shouldMinimizeToTrayOnClose(options: {
  keepInBackground?: boolean
  isQuitting: boolean
}): boolean {
  return Boolean(options.keepInBackground && !options.isQuitting)
}

// 16x16 dark cyan badge PNG data URL for the system tray
const TRAY_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAACdJREFUOE9jZGBg+M9AAWBUgI0BowaMGjBqwKgBowYwDLoBDAwMABpOAQHot6zCAAAAAElFTkSuQmCC'

export interface TrayHost {
  Tray: typeof ElectronTray
  Menu: typeof ElectronMenu
  nativeImage: typeof ElectronNativeImage
  onOpenWindow: () => void
  onQuickCapture: () => void
  onQuitApp: () => void
}

export class SystemTrayManager {
  private tray: ElectronTray | null = null

  constructor(private readonly host: TrayHost) {}

  ensureCreated(): void {
    if (this.tray) return
    try {
      const icon = this.host.nativeImage.createFromDataURL(TRAY_ICON_DATA_URL)
      this.tray = new this.host.Tray(icon)
      this.tray.setToolTip('Mike Assist')
      const menu = this.host.Menu.buildFromTemplate([
        {
          label: 'Quick capture',
          click: () => this.host.onQuickCapture()
        },
        {
          label: 'Open Mike Assist',
          click: () => this.host.onOpenWindow()
        },
        { type: 'separator' },
        {
          label: 'Quit Mike Assist',
          click: () => this.host.onQuitApp()
        }
      ])
      this.tray.setContextMenu(menu)
      this.tray.on('click', () => this.host.onOpenWindow())
    } catch (error) {
      console.warn('[tray] could not initialize system tray', error)
    }
  }

  dispose(): void {
    if (!this.tray) return
    try {
      this.tray.destroy()
    } catch {
      // Ignore tray destruction errors during app shutdown.
    }
    this.tray = null
  }
}
