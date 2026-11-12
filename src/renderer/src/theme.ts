export const APP_THEME_STORAGE_KEY = 'mike-assist-theme'

export const APP_THEMES = [
  { id: 'midnight', label: 'Midnight', description: 'Graphite surfaces with a clear sea-glass accent.' },
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
    return parseAppTheme(source.getItem(APP_THEME_STORAGE_KEY))
  } catch {
    return 'midnight'
  }
}

export function applyAppTheme(root: Pick<HTMLElement, 'dataset'>, theme: AppTheme): void {
  root.dataset.theme = theme
}
