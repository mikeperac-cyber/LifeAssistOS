import { describe, expect, it } from 'vitest'
import {
  NAV_GROUPS,
  normalizeView,
  normalizeSidebarVisibility,
  readSidebarVisibility,
  SIDEBAR_VISIBILITY_STORAGE_KEY,
  shouldHandleQuickCaptureShortcut,
  VIEW_META
} from '../src/renderer/src/navigation'

const shortcut = {
  key: 'k',
  ctrlKey: true,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  defaultPrevented: false
}

describe('navigation', () => {
  it('test_navigation_exposes_only_tasks_and_settings', () => {
    expect(Object.keys(VIEW_META)).toEqual(['tasks', 'settings'])
    expect(NAV_GROUPS.flatMap((group) => group.items)).toEqual(['tasks', 'settings'])
    expect(normalizeView(undefined)).toBe('tasks')
  })

  it('test_legacy_view_ids_fall_back_to_tasks', () => {
    for (const route of ['chat', 'today', 'work', 'email', 'coach', 'scheduled', 'research', 'vault', 'cloud_files', 'teaching', 'integrations', 'activity', 'finances', 'workflows', 'skills', 'unknown']) {
      expect(normalizeView(route)).toBe('tasks')
    }
    expect(normalizeView('settings')).toBe('settings')
  })

  it('normalizes saved sidebar visibility and defaults invalid values to open', () => {
    expect(normalizeSidebarVisibility('closed')).toBe('closed')
    expect(normalizeSidebarVisibility('open')).toBe('open')
    expect(normalizeSidebarVisibility(null)).toBe('open')
    expect(normalizeSidebarVisibility('pinned')).toBe('open')
  })

  it('defaults to open when local storage cannot be read', () => {
    expect(readSidebarVisibility(() => { throw new Error('storage unavailable') })).toBe('open')
  })

  it('reads the saved value using the sidebar storage key', () => {
    let requestedKey = ''
    expect(readSidebarVisibility((key) => { requestedKey = key; return 'closed' })).toBe('closed')
    expect(requestedKey).toBe(SIDEBAR_VISIBILITY_STORAGE_KEY)
  })

  it('places every view in the navigation exactly once', () => {
    const items = NAV_GROUPS.flatMap((group) => group.items)
    expect([...items].sort()).toEqual(Object.keys(VIEW_META).sort())
    expect(new Set(items).size).toBe(items.length)
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
