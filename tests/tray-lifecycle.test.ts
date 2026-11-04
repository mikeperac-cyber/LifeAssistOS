import { describe, expect, it } from 'vitest'
import { shouldMinimizeToTrayOnClose } from '../src/main/tray'

describe('System tray background lifecycle', () => {
  it('minimizes to tray on window close only when keepInBackground is true and app is not quitting', () => {
    expect(shouldMinimizeToTrayOnClose({ keepInBackground: true, isQuitting: false })).toBe(true)
    expect(shouldMinimizeToTrayOnClose({ keepInBackground: true, isQuitting: true })).toBe(false)
    expect(shouldMinimizeToTrayOnClose({ keepInBackground: false, isQuitting: false })).toBe(false)
    expect(shouldMinimizeToTrayOnClose({ keepInBackground: undefined, isQuitting: false })).toBe(false)
  })
})
