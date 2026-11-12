import { describe, expect, it, vi } from 'vitest'
import { shouldMinimizeToTrayOnClose, SystemTrayManager, type TrayHost } from '../src/main/tray'

describe('System tray background lifecycle', () => {
  it('minimizes to tray on window close only when keepInBackground is true and app is not quitting', () => {
    expect(shouldMinimizeToTrayOnClose({ keepInBackground: true, isQuitting: false })).toBe(true)
    expect(shouldMinimizeToTrayOnClose({ keepInBackground: true, isQuitting: true })).toBe(false)
    expect(shouldMinimizeToTrayOnClose({ keepInBackground: false, isQuitting: false })).toBe(false)
    expect(shouldMinimizeToTrayOnClose({ keepInBackground: undefined, isQuitting: false })).toBe(false)
  })

  it('uses the packaged icon and adds Quick Capture alongside open and quit', () => {
    let menuItems: Array<{ label?: string; click?: () => void }> = []
    let destroyTray: (() => void) | undefined
    const onOpenWindow = vi.fn()
    const onQuickCapture = vi.fn()
    const onQuitApp = vi.fn()
    const createFromPath = vi.fn(() => ({ isEmpty: () => false }))
    class FakeTray {
      setToolTip(): void {}
      setContextMenu(): void {}
      on(): void {}
      destroy(): void { destroyTray?.() }
    }
    const host = {
      Tray: FakeTray,
      Menu: { buildFromTemplate: (items: typeof menuItems) => { menuItems = items; return items } },
      nativeImage: { createFromPath },
      iconPath: 'app-icon.png',
      onOpenWindow,
      onQuickCapture,
      onQuitApp
    } as unknown as TrayHost
    const manager = new SystemTrayManager(host)

    expect(manager.ensureCreated()).toBe(true)
    expect(createFromPath).toHaveBeenCalledWith('app-icon.png')
    menuItems.find((item) => item.label === 'Quick capture')?.click?.()
    menuItems.find((item) => item.label === 'Open LifeAssistOS')?.click?.()
    menuItems.find((item) => item.label === 'Quit LifeAssistOS')?.click?.()
    expect(onQuickCapture).toHaveBeenCalledOnce()
    expect(onOpenWindow).toHaveBeenCalledOnce()
    expect(onQuitApp).toHaveBeenCalledOnce()

    destroyTray = vi.fn()
    manager.dispose()
    expect(destroyTray).toHaveBeenCalledOnce()
  })

  it('reports tray initialization failure so the window can close normally', () => {
    const host = {
      Tray: class { constructor() { throw new Error('Tray unavailable') } },
      Menu: { buildFromTemplate: () => [] },
      nativeImage: { createFromPath: () => ({ isEmpty: () => false }) },
      iconPath: 'app-icon.png',
      onOpenWindow: vi.fn(),
      onQuickCapture: vi.fn(),
      onQuitApp: vi.fn()
    } as unknown as TrayHost
    const manager = new SystemTrayManager(host)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(manager.ensureCreated()).toBe(false)

    warn.mockRestore()
  })

  it('does not create a tray with a missing icon', () => {
    const Tray = vi.fn()
    const host = {
      Tray,
      Menu: { buildFromTemplate: () => [] },
      nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
      iconPath: 'missing.png',
      onOpenWindow: vi.fn(),
      onQuickCapture: vi.fn(),
      onQuitApp: vi.fn()
    } as unknown as TrayHost
    const manager = new SystemTrayManager(host)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(manager.ensureCreated()).toBe(false)
    expect(Tray).not.toHaveBeenCalled()

    warn.mockRestore()
  })
})
