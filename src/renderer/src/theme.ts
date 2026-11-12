export const APP_THEME_STORAGE_KEY = 'mike-assist-theme-v2'

const LEGACY_APP_THEME_STORAGE_KEY = 'mike-assist-theme'

export const APP_THEMES = [
  { id: 'midnight', label: 'Midnight', description: 'Charcoal surfaces with violet, rose, and warm gold accents.' },
  { id: 'light', label: 'Light', description: 'Chalk-white surfaces with a calm indigo accent.' },
  { id: 'forest', label: 'Forest', description: 'Evergreen surfaces with a fresh leaf accent.' },
  { id: 'violet', label: 'Violet', description: 'Ink-plum surfaces with a soft lilac accent.' },
  { id: 'blueprint', label: 'Blueprint', description: 'Deep navy surfaces with a bright drafting-blue accent.' }
] as const

export type AppTheme = (typeof APP_THEMES)[number]['id']

export function parseAppTheme(value: unknown): AppTheme {
  return APP_THEMES.some((theme) => theme.id === value)
    ? (value as AppTheme)
    : 'midnight'
}

export function getSavedAppTheme(storage?: Pick<Storage, 'getItem'>): AppTheme {
  try {
    const source = storage ?? window.localStorage
    const savedTheme = source.getItem(APP_THEME_STORAGE_KEY)
    if (savedTheme !== null) return parseAppTheme(savedTheme)

    const legacyTheme = source.getItem(LEGACY_APP_THEME_STORAGE_KEY)
    return parseAppTheme(legacyTheme)
  } catch {
    return 'midnight'
  }
}

export function applyAppTheme(root: Pick<HTMLElement, 'dataset'>, theme: AppTheme): void {
  root.dataset.theme = theme
}
