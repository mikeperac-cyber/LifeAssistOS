import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_THEMES, APP_THEME_STORAGE_KEY, getSavedAppTheme, parseAppTheme } from '../src/renderer/src/theme'

const styles = readFileSync(path.resolve('src/renderer/src/styles.css'), 'utf8')

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

  it('uses focus-ring colors with strong contrast against every theme surface', () => {
    const rootTokens: Record<string, string> = {}
    const themedTokens = new Map<string, Record<string, string>>()
    for (const match of styles.matchAll(/:root(?:\[data-theme='([^']+)'\])?\s*\{([^}]+)\}/g)) {
      const themeId = match[1]
      const tokens = Object.fromEntries(
        Array.from(match[2].matchAll(/--([\w-]+):\s*([^;]+);/g), (token) => [token[1], token[2].trim()])
      )
      if (themeId) themedTokens.set(themeId, tokens)
      else Object.assign(rootTokens, tokens)
    }

    expect(rootTokens['focus-ring']).toBe('var(--accent-strong)')
    for (const theme of APP_THEMES) {
      const tokens = { ...rootTokens, ...themedTokens.get(theme.id) }
      const focusRing = tokens['accent-strong']
      expect(contrastRatio(focusRing, tokens.panel), `${theme.label} focus ring on panel`).toBeGreaterThanOrEqual(3)
      expect(contrastRatio(focusRing, tokens.bg), `${theme.label} focus ring on app background`).toBeGreaterThanOrEqual(3)
    }
  })

  it('does not suppress keyboard focus outlines in component focus rules', () => {
    const suppressingRules = Array.from(styles.matchAll(/([^{}]+)\{([^{}]*)\}/g))
      .filter(([, selector, declarations]) =>
        /:focus(?:-visible|-within)?\b/.test(selector) && /outline\s*:\s*none\b/i.test(declarations)
      )
      .map(([, selector]) => selector.trim())

    expect(suppressingRules).toEqual([])
  })
})

function contrastRatio(first: string, second: string | undefined): number {
  const firstLuminance = luminance(first)
  const secondLuminance = luminance(second ?? '')
  return (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
}

function luminance(color: string): number {
  if (!/^#[\da-f]{6}$/i.test(color)) throw new Error(`Expected an opaque six-digit color, received ${color}.`)
  const channels = color.slice(1).match(/.{2}/g)!.map((channel) => {
    const value = Number.parseInt(channel, 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}
