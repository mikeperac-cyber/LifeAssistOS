import type { Menu as ElectronMenu, Tray as ElectronTray, nativeImage as ElectronNativeImage } from 'electron'

export function shouldMinimizeToTrayOnClose(options: {
  keepInBackground?: boolean
  isQuitting: boolean
}): boolean {
  return Boolean(options.keepInBackground && !options.isQuitting)
}

export interface TrayHost {
  Tray: typeof ElectronTray
  Menu: typeof ElectronMenu
  nativeImage: typeof ElectronNativeImage
  iconPath: string
  onOpenWindow: () => void
  onQuickCapture: () => void
  onQuitApp: () => void
}

export class SystemTrayManager {
  private tray: ElectronTray | null = null

  constructor(private readonly host: TrayHost) {}

  ensureCreated(): boolean {
    if (this.tray) return true
    let tray: ElectronTray | null = null
    try {
      const icon = this.host.nativeImage.createFromPath(this.host.iconPath)
      if (icon.isEmpty()) throw new Error(`Tray icon could not be loaded from ${this.host.iconPath}`)
      tray = new this.host.Tray(icon)
      tray.setToolTip('Mike Assist')
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
      tray.setContextMenu(menu)
      tray.on('click', () => this.host.onOpenWindow())
      this.tray = tray
      return true
    } catch (error) {
      try {
        tray?.destroy()
      } catch {
        // Ignore cleanup errors after partial tray initialization.
      }
      console.warn('[tray] could not initialize system tray', error)
      return false
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
