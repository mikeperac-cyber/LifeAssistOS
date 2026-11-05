import { describe, expect, it, vi } from 'vitest'
import { shouldMinimizeToTrayOnClose, SystemTrayManager, type TrayHost } from '../src/main/tray'

describe('System tray background lifecycle', () => {
  it('minimizes to tray on window close only when keepInBackground is true and app is not quitting', () => {
    expect(shouldMinimizeToTrayOnClose({ keepInBackground: true, isQuitting: false })).toBe(true)
    expect(shouldMinimizeToTrayOnClose({ keepInBackground: true, isQuitting: true })).toBe(false)
    expect(shouldMinimizeToTrayOnClose({ keepInBackground: false, isQuitting: false })).toBe(false)
    expect(shouldMinimizeToTrayOnClose({ keepInBackground: undefined, isQuitting: false })).toBe(false)
  })

  it('adds a Quick Capture tray action alongside open and quit', () => {
    let menuItems: Array<{ label?: string; click?: () => void }> = []
    let destroyTray: (() => void) | undefined
    const onOpenWindow = vi.fn()
    const onQuickCapture = vi.fn()
    const onQuitApp = vi.fn()
    class FakeTray {
      setToolTip(): void {}
      setContextMenu(): void {}
      on(): void {}
      destroy(): void { destroyTray?.() }
    }
    const host = {
      Tray: FakeTray,
      Menu: { buildFromTemplate: (items: typeof menuItems) => { menuItems = items; return items } },
      nativeImage: { createFromDataURL: () => ({}) },
      onOpenWindow,
      onQuickCapture,
      onQuitApp
    } as unknown as TrayHost
    const manager = new SystemTrayManager(host)

    manager.ensureCreated()
    menuItems.find((item) => item.label === 'Quick capture')?.click?.()
    menuItems.find((item) => item.label === 'Open Mike Assist')?.click?.()
    menuItems.find((item) => item.label === 'Quit Mike Assist')?.click?.()
    expect(onQuickCapture).toHaveBeenCalledOnce()
    expect(onOpenWindow).toHaveBeenCalledOnce()
    expect(onQuitApp).toHaveBeenCalledOnce()

    destroyTray = vi.fn()
    manager.dispose()
    expect(destroyTray).toHaveBeenCalledOnce()
  })
})
