export const APP_THEME_STORAGE_KEY = 'mike-assist-theme'

export const APP_THEMES = [
  { id: 'midnight', label: 'Midnight', description: 'Deep charcoal with clear teal accents.' },
  { id: 'light', label: 'Light', description: 'Bright surfaces with calm, high-contrast text.' },
  { id: 'forest', label: 'Forest', description: 'Dark evergreen surfaces with fresh green accents.' },
  { id: 'violet', label: 'Violet', description: 'Dark plum surfaces with soft violet accents.' }
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
