import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SIDEBAR_SHORTCUTS,
  filterNavigationGroups,
  NAV_GROUPS,
  normalizeSidebarShortcuts,
  shouldHandleNavigationShortcut,
  shouldHandleQuickCaptureShortcut,
  VIEW_META
} from '../src/renderer/src/navigation'
import { searchNavigationViews } from '../src/renderer/src/global-search'

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

  it('defaults to task, work, and workflow shortcuts and safely normalizes saved choices', () => {
    expect(DEFAULT_SIDEBAR_SHORTCUTS).toEqual(['today', 'work', 'workflows'])
    expect(normalizeSidebarShortcuts(['email', 'today', 'email', 'missing', 'vault', 'settings'])).toEqual([
      'email', 'today', 'vault', 'settings'
    ])
    expect(normalizeSidebarShortcuts(null)).toEqual(DEFAULT_SIDEBAR_SHORTCUTS)
  })

  it('finds the Work hub in global navigation search', () => {
    expect(searchNavigationViews('work')).toContain('work')
  })

  it('prefers direct section matches over a matching group label', () => {
    expect(filterNavigationGroups('work').flatMap((group) => group.items)).toEqual(['work', 'workflows'])
    expect(filterNavigationGroups('workspace').flatMap((group) => group.items)).toEqual(['chat', 'today', 'work', 'coach'])
  })

  it('finds Tasks by the name used in quick access', () => {
    expect(filterNavigationGroups('tasks').flatMap((group) => group.items)).toEqual(['today'])
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
