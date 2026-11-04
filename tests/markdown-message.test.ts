import { describe, expect, it } from 'vitest'
import { parseInlineTokens, parseMarkdownBlocks } from '../src/renderer/src/components/MarkdownMessage'

describe('parseMarkdownBlocks', () => {
  it('parses headings, paragraphs, fenced code blocks, lists, and tables', () => {
    const sample = [
      '## Lesson Plan',
      '',
      'Here is the intro paragraph.',
      '',
      '- Warm-up question',
      '- Vocabulary check',
      '',
      '```typescript',
      'const score = 8.5;',
      '```',
      '',
      '| Criterion | Band |',
      '| --- | --- |',
      '| Lexical | 8.0 |'
    ].join('\n')

    const blocks = parseMarkdownBlocks(sample)
    expect(blocks).toEqual([
      { kind: 'heading', level: 2, text: 'Lesson Plan' },
      { kind: 'paragraph', text: 'Here is the intro paragraph.' },
      { kind: 'list', ordered: false, items: ['Warm-up question', 'Vocabulary check'] },
      { kind: 'code', language: 'typescript', code: 'const score = 8.5;' },
      { kind: 'table', headers: ['Criterion', 'Band'], rows: [['Lexical', '8.0']] }
    ])
  })
})

describe('parseInlineTokens', () => {
  it('parses inline code, bold text, and [M#] memory citations', () => {
    const tokens = parseInlineTokens('Based on [M1] and **IELTS rubric** in `band-descriptors.md` [M2].')
    expect(tokens).toEqual([
      { kind: 'text', text: 'Based on ' },
      { kind: 'citation', label: 'M1', index: 1 },
      { kind: 'text', text: ' and ' },
      { kind: 'bold', text: 'IELTS rubric' },
      { kind: 'text', text: ' in ' },
      { kind: 'code', text: 'band-descriptors.md' },
      { kind: 'text', text: ' ' },
      { kind: 'citation', label: 'M2', index: 2 },
      { kind: 'text', text: '.' }
    ])
  })
})
