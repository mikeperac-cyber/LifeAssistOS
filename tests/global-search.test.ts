import { describe, expect, it } from 'vitest'
import { globalSearchKeyAction, globalSearchMatches, normalizeGlobalSearchText, searchNavigationViews } from '../src/renderer/src/global-search'

describe('global search helpers', () => {
  it('keeps native text editing keys and maps only list navigation keys', () => {
    expect(globalSearchKeyAction('ArrowDown')).toBe('next')
    expect(globalSearchKeyAction('ArrowUp')).toBe('previous')
    expect(globalSearchKeyAction('Enter')).toBe('select')
    expect(globalSearchKeyAction('Escape')).toBe('close')
    expect(globalSearchKeyAction('Home')).toBeNull()
    expect(globalSearchKeyAction('End')).toBeNull()
  })

  it('normalizes and matches every query term without losing Unicode letters', () => {
    expect(normalizeGlobalSearchText('  İzinler & Planlar  ')).toBe('izinler planlar')
    expect(globalSearchMatches('plan tasks', 'Today — plan and tasks, with next actions')).toBe(true)
    expect(globalSearchMatches('plan mail', 'Today — tasks and next actions')).toBe(false)
    expect(globalSearchMatches('', 'Any section')).toBe(true)
  })

  it('finds sections through common user terms and keeps each route unique', () => {
    expect(searchNavigationViews('budget')).toContain('finances')
    expect(searchNavigationViews('gmail connection')).toContain('integrations')
    expect(searchNavigationViews('outlook email')).toContain('email')
    expect(searchNavigationViews('onedrive files')).toContain('cloud_files')
    expect(searchNavigationViews('capture task')).toContain('today')
    expect(new Set(searchNavigationViews('')).size).toBe(searchNavigationViews('').length)
  })
})
