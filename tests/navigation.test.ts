import { describe, expect, it } from 'vitest'
import { NAV_GROUPS, shouldHandleNavigationShortcut, shouldHandleQuickCaptureShortcut, VIEW_META } from '../src/renderer/src/navigation'

const shortcut = {
  key: 'k',
  ctrlKey: true,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  defaultPrevented: false
}

describe('navigation', () => {
  it('places every view in the navigation exactly once', () => {
    const items = NAV_GROUPS.flatMap((group) => group.items)
    expect([...items].sort()).toEqual(Object.keys(VIEW_META).sort())
    expect(new Set(items).size).toBe(items.length)
  })

  it('keeps the global navigation shortcut out of editors and dialogs', () => {
    expect(shouldHandleNavigationShortcut(shortcut)).toBe(true)
    expect(shouldHandleNavigationShortcut({ ...shortcut, metaKey: true, ctrlKey: false })).toBe(true)
    expect(shouldHandleNavigationShortcut(shortcut, true)).toBe(false)
    expect(shouldHandleNavigationShortcut({ ...shortcut, defaultPrevented: true })).toBe(false)
    expect(shouldHandleNavigationShortcut({ ...shortcut, shiftKey: true })).toBe(false)
    expect(shouldHandleNavigationShortcut({ ...shortcut, altKey: true })).toBe(false)
    expect(shouldHandleNavigationShortcut({ ...shortcut, key: 'x' })).toBe(false)
  })

  it('keeps quick capture on its own shortcut and out of editors and dialogs', () => {
    const quickCapture = { ...shortcut, shiftKey: true }
    expect(shouldHandleQuickCaptureShortcut(quickCapture)).toBe(true)
    expect(shouldHandleQuickCaptureShortcut({ ...quickCapture, metaKey: true, ctrlKey: false })).toBe(true)
    expect(shouldHandleQuickCaptureShortcut(quickCapture, true)).toBe(false)
    expect(shouldHandleQuickCaptureShortcut({ ...quickCapture, defaultPrevented: true })).toBe(false)
    expect(shouldHandleQuickCaptureShortcut({ ...quickCapture, shiftKey: false })).toBe(false)
    expect(shouldHandleQuickCaptureShortcut({ ...quickCapture, altKey: true })).toBe(false)
    expect(shouldHandleQuickCaptureShortcut({ ...quickCapture, key: 'x' })).toBe(false)
  })
})
