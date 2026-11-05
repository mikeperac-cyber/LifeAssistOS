import { describe, expect, it } from 'vitest'
import { globalSearchMatches, normalizeGlobalSearchText, searchNavigationViews } from '../src/renderer/src/global-search'

describe('global search helpers', () => {
  it('normalizes and matches every query term without losing Unicode letters', () => {
    expect(normalizeGlobalSearchText('  İzinler & Planlar  ')).toBe('izinler planlar')
    expect(globalSearchMatches('plan tasks', 'Today — plan and tasks, with next actions')).toBe(true)
    expect(globalSearchMatches('plan mail', 'Today — tasks and next actions')).toBe(false)
    expect(globalSearchMatches('', 'Any section')).toBe(true)
  })

  it('finds sections through common user terms and keeps each route unique', () => {
    expect(searchNavigationViews('budget')).toContain('finances')
    expect(searchNavigationViews('gmail connection')).toContain('integrations')
    expect(searchNavigationViews('capture task')).toContain('today')
    expect(new Set(searchNavigationViews('')).size).toBe(searchNavigationViews('').length)
  })
})
