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
    const { rootTokens, themedTokens } = getThemeTokenSets()

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

  it('keeps semantic tint colors synchronized with each theme palette', () => {
    const { rootTokens, themedTokens } = getThemeTokenSets()
    const literalPaletteTints = Array.from(styles.matchAll(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,/g))
      .map(([, red, green, blue]) => `${red},${green},${blue}`)
      .filter((rgb) => [
        '86,214,192', '21,121,111', '124,221,164', '196,168,255',
        '240,179,91', '190,129,28', '255,186,73', '240,122,122', '169,52,60',
        '122,167,240', '40,91,153', '141,185,239', '145,181,243',
        '176,138,240', '153,133,255', '105,71,160', '193,164,239', '208,183,255'
      ].includes(rgb))

    expect(literalPaletteTints).toEqual([])
    for (const theme of APP_THEMES) {
      const tokens = { ...rootTokens, ...themedTokens.get(theme.id) }
      for (const color of ['accent', 'amber', 'red', 'blue', 'purple']) {
        expect(parseRgb(tokens[`${color}-rgb`]), `${theme.label} ${color} tint`).toEqual(hexRgb(tokens[color]))
      }
    }
  })

  it('uses theme surfaces for task groups and the quick capture dialog', () => {
    expect(styles).toMatch(/\.todo-task-group,\s*\.todo-inbox-item\s*\{[^}]*background:\s*var\(--panel\)/s)
    expect(styles).toMatch(/\.quick-capture-dialog\s*\{[^}]*background:\s*var\(--modal-gradient\)/s)
  })
})

function getThemeTokenSets(): {
  rootTokens: Record<string, string>
  themedTokens: Map<string, Record<string, string>>
} {
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
  return { rootTokens, themedTokens }
}

function parseRgb(value: string | undefined): number[] {
  if (!value) throw new Error('Expected an RGB color token.')
  const channels = value.split(',').map((channel) => Number(channel.trim()))
  if (channels.length !== 3 || channels.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255)) {
    throw new Error(`Expected three integer RGB channels, received ${value}.`)
  }
  return channels
}

function hexRgb(value: string | undefined): number[] {
  if (!value || !/^#[\da-f]{6}$/i.test(value)) throw new Error(`Expected an opaque six-digit color, received ${value}.`)
  return value.slice(1).match(/.{2}/g)!.map((channel) => Number.parseInt(channel, 16))
}

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
