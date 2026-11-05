import { describe, expect, it } from 'vitest'
import type { ConnectedCloudFile, ConnectedCloudFileReadOutput } from '../src/shared/ipc'
import { nextConnectedFileReadCursor } from '../src/renderer/src/components/ConnectedFilesView'

const file = (mimeType: string): ConnectedCloudFile => ({ id: 'abc123_file', name: 'Report', mimeType })

describe('connected file reading', () => {
  it('continues bounded text and Word extracts by character offset', () => {
    expect(nextConnectedFileReadCursor(file('text/plain'), { text: 'part', truncated: true, nextStartChar: 5000 }))
      .toEqual({ startChar: 5000 })
    expect(nextConnectedFileReadCursor(file('application/vnd.openxmlformats-officedocument.wordprocessingml.document'), { text: 'part', truncated: true, nextChar: 800 }))
      .toEqual({ startChar: 800 })
  })

  it('continues PDF extracts at the returned page and character cursor', () => {
    expect(nextConnectedFileReadCursor(file('application/pdf'), { text: 'part', truncated: true, nextPage: 3, nextChar: 120 }))
      .toEqual({ startPage: 3, startChar: 120 })
  })

  it('continues Excel rows before advancing to the next sheet', () => {
    const workbook = file('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    const output: ConnectedCloudFileReadOutput = {
      text: 'part', truncated: true, nextSheet: 4,
      sheetRanges: [{ sheet: 2, nextRow: 21 }, { sheet: 3 }]
    }
    expect(nextConnectedFileReadCursor(workbook, output)).toEqual({ startSheet: 2, startRow: 21 })
    expect(nextConnectedFileReadCursor(workbook, { text: 'part', truncated: true, nextSheet: 4 }))
      .toEqual({ startSheet: 4 })
  })

  it('does not offer continuation for complete or unbounded extracts', () => {
    expect(nextConnectedFileReadCursor(file('text/plain'), { text: 'complete', truncated: false, nextStartChar: 12 })).toBeNull()
    expect(nextConnectedFileReadCursor(file('text/plain'), { text: 'unknown', truncated: true })).toBeNull()
  })
})
