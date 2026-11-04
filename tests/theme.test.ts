import { describe, expect, it } from 'vitest'
import { APP_THEME_STORAGE_KEY, getSavedAppTheme, parseAppTheme } from '../src/renderer/src/theme'

describe('app theme preferences', () => {
  it('accepts only a supported theme id', () => {
    expect(parseAppTheme('forest')).toBe('forest')
    expect(parseAppTheme('unknown')).toBe('midnight')
    expect(parseAppTheme(null)).toBe('midnight')
  })

  it('loads the saved theme and falls back when storage fails', () => {
    const storage = {
      getItem: (key: string) => key === APP_THEME_STORAGE_KEY ? 'light' : null
    }
    expect(getSavedAppTheme(storage)).toBe('light')
    expect(getSavedAppTheme({ getItem: () => { throw new Error('unavailable') } })).toBe('midnight')
  })
})
