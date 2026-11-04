import { createHash } from 'node:crypto'
import type { McpServerRecord } from '../../shared/types'

/** Characters allowed in OpenAI function names. */
const INVOCATION_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** Longest function name every provider accepts in this design. */
const MAX_INVOCATION_LENGTH = 64

export function sanitizeSegment(input: string, maxLength = 24): string {
  const cleaned = input
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLength)
  return cleaned.length > 0 ? cleaned : 'server'
}

/**
 * Builds a stable, provider-safe invocation name in the shape
 * `mcp__<server>__<tool>`. When the plain name would exceed the OpenAI 64-char
 * budget, both segments are trimmed and an 8-character content hash is appended
 * so two different tools can never collide.
 */
export function invocationName(serverName: string, toolName: string): string {
  const server = sanitizeSegment(serverName, 18)
  const tool = sanitizeSegment(toolName, 30)
  const plain = `mcp__${server}__${tool}`
  const wasTrimmed = server !== serverName.trim() || tool !== toolName.trim()
  if (plain.length <= MAX_INVOCATION_LENGTH && !wasTrimmed) return plain

  const hash = createHash('sha256').update(`${serverName}:${toolName}`).digest('hex').slice(0, 8)
  const suffix = hash
  let serverPart = server
  let toolPart = tool
  let candidate = `mcp__${serverPart}__${toolPart}_${suffix}`
  while (candidate.length > MAX_INVOCATION_LENGTH) {
    if (toolPart.length > 4) toolPart = toolPart.slice(0, toolPart.length - 1)
    else if (serverPart.length > 4) serverPart = serverPart.slice(0, serverPart.length - 1)
    else break
    candidate = `mcp__${serverPart}__${toolPart}_${suffix}`
  }
  return candidate
}

export function isValidInvocationName(name: string): boolean {
  return INVOCATION_PATTERN.test(name)
}

/** Builds the natural-language prefix Mike Assist shows for MCP tools. */
export function describeServer(record: Pick<McpServerRecord, 'transport' | 'command' | 'args' | 'url'>): string {
  if (record.transport === 'http') return record.url ?? ''
  const command = record.command ?? ''
  const args = (record.args ?? []).join(' ')
  return [command, args].filter(Boolean).join(' ') || command
}
