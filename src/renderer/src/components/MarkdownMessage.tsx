import { useState } from 'react'

export type MarkdownBlock =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; language: string; code: string }
  | { kind: 'table'; headers: string[]; rows: string[][] }

export type InlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'citation'; label: string; index: number }

export function parseMarkdownBlocks(raw: string): MarkdownBlock[] {
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Skip blank lines
    if (!line.trim()) {
      i += 1
      continue
    }

    // Fenced code block
    const fenceMatch = /^```([\w+-]*)\s*$/.exec(line.trim())
    if (fenceMatch) {
      const language = fenceMatch[1] || 'text'
      const codeLines: string[] = []
      i += 1
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        codeLines.push(lines[i])
        i += 1
      }
      if (i < lines.length) i += 1 // consume closing fence
      blocks.push({ kind: 'code', language, code: codeLines.join('\n') })
      continue
    }

    // Heading
    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(line.trim())
    if (headingMatch) {
      const level = Math.min(4, Math.max(1, headingMatch[1].length)) as 1 | 2 | 3 | 4
      blocks.push({ kind: 'heading', level, text: headingMatch[2].trim() })
      i += 1
      continue
    }

    // Table
    if (
      line.trim().startsWith('|') &&
      i + 1 < lines.length &&
      /^\|\s*[-:]+(\s*\|\s*[-:]+)*\s*\|?$/.test(lines[i + 1].trim())
    ) {
      const parseCells = (rowLine: string): string[] =>
        rowLine
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((cell) => cell.trim())

      const headers = parseCells(line)
      i += 2 // skip header and separator
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(parseCells(lines[i]))
        i += 1
      }
      blocks.push({ kind: 'table', headers, rows })
      continue
    }

    // Unordered or ordered list
    const bulletMatch = /^([-*])\s+(.+)$/.exec(line.trim())
    const orderedMatch = /^(\d+)\.\s+(.+)$/.exec(line.trim())
    if (bulletMatch || orderedMatch) {
      const ordered = Boolean(orderedMatch)
      const items: string[] = []
      while (i < lines.length) {
        const current = lines[i].trim()
        const b = /^([-*])\s+(.+)$/.exec(current)
        const o = /^(\d+)\.\s+(.+)$/.exec(current)
        if ((ordered && o) || (!ordered && b)) {
          items.push((ordered ? o![2] : b![2]).trim())
          i += 1
        } else {
          break
        }
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    // Paragraph (accumulate until blank line or block starter)
    const paragraphLines: string[] = [line]
    i += 1
    while (i < lines.length) {
      const next = lines[i]
      const trimmed = next.trim()
      if (
        !trimmed ||
        /^```/.test(trimmed) ||
        /^(#{1,4})\s+/.test(trimmed) ||
        /^([-*]|\d+\.)\s+/.test(trimmed) ||
        (trimmed.startsWith('|') &&
          i + 1 < lines.length &&
          /^\|\s*[-:]+/.test(lines[i + 1].trim()))
      ) {
        break
      }
      paragraphLines.push(next)
      i += 1
    }
    blocks.push({ kind: 'paragraph', text: paragraphLines.join('\n') })
  }

  return blocks
}

export function parseInlineTokens(text: string): InlineToken[] {
  const tokens: InlineToken[] = []
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[M(\d+)\])/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ kind: 'text', text: text.slice(lastIndex, match.index) })
    }
    const full = match[0]
    if (full.startsWith('`') && full.endsWith('`')) {
      tokens.push({ kind: 'code', text: full.slice(1, -1) })
    } else if (full.startsWith('**') && full.endsWith('**')) {
      tokens.push({ kind: 'bold', text: full.slice(2, -2) })
    } else if (match[2]) {
      const index = Number.parseInt(match[2], 10)
      tokens.push({ kind: 'citation', label: `M${index}`, index })
    }
    lastIndex = pattern.lastIndex
  }

  if (lastIndex < text.length) {
    tokens.push({ kind: 'text', text: text.slice(lastIndex) })
  }

  return tokens
}

function InlineContent({
  text,
  onCitationClick
}: {
  text: string
  onCitationClick?: (label: string) => void
}): React.JSX.Element {
  const tokens = parseInlineTokens(text)
  return (
    <>
      {tokens.map((token, idx) => {
        if (token.kind === 'code') {
          return <code key={idx} className="md-inline-code">{token.text}</code>
        }
        if (token.kind === 'bold') {
          return <strong key={idx}>{token.text}</strong>
        }
        if (token.kind === 'citation') {
          return (
            <button
              key={idx}
              type="button"
              className="citation-chip"
              title={`Open Memory citation [${token.label}]`}
              onClick={() => onCitationClick?.(token.label)}
            >
              [{token.label}]
            </button>
          )
        }
        return <span key={idx}>{token.text}</span>
      })}
    </>
  )
}

function CodeBlockView({ language, code }: { language: string; code: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  const copyCode = (): void => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="md-code-block">
      <div className="md-code-header">
        <span className="md-code-lang">{language}</span>
        <button type="button" className="ghost-button md-copy-btn" onClick={copyCode}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  )
}

export function MarkdownMessage({
  text,
  onCitationClick
}: {
  text: string
  onCitationClick?: (label: string) => void
}): React.JSX.Element {
  const blocks = parseMarkdownBlocks(text)
  if (blocks.length === 0) {
    return <div className="md-content">{text}</div>
  }

  return (
    <div className="md-content">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'heading': {
            const Tag = `h${block.level}` as 'h1' | 'h2' | 'h3' | 'h4'
            return (
              <Tag key={index} className={`md-heading md-h${block.level}`}>
                <InlineContent text={block.text} onCitationClick={onCitationClick} />
              </Tag>
            )
          }
          case 'paragraph':
            return (
              <p key={index} className="md-paragraph">
                <InlineContent text={block.text} onCitationClick={onCitationClick} />
              </p>
            )
          case 'list': {
            const ListTag = block.ordered ? 'ol' : 'ul'
            return (
              <ListTag key={index} className="md-list">
                {block.items.map((item, itemIdx) => (
                  <li key={itemIdx}>
                    <InlineContent text={item} onCitationClick={onCitationClick} />
                  </li>
                ))}
              </ListTag>
            )
          }
          case 'code':
            return <CodeBlockView key={index} language={block.language} code={block.code} />
          case 'table':
            return (
              <div key={index} className="md-table-wrap">
                <table className="md-table">
                  <thead>
                    <tr>
                      {block.headers.map((header, hIdx) => (
                        <th key={hIdx}>
                          <InlineContent text={header} onCitationClick={onCitationClick} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rIdx) => (
                      <tr key={rIdx}>
                        {row.map((cell, cIdx) => (
                          <td key={cIdx}>
                            <InlineContent text={cell} onCitationClick={onCitationClick} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        }
      })}
    </div>
  )
}
