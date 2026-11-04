import { isIP } from 'node:net'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { readJsonStore } from './json-store'

interface SpeechFile {
  version: 1
  endpoint: string
}

/** User-configured local transcription endpoint. Remote hosts are rejected. */
export class SpeechSettingsStore {
  private endpoint = ''
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly file: string) {}

  async init(): Promise<void> {
    await this.mutate(async () => {
      await mkdir(path.dirname(this.file), { recursive: true })
      const parsed = await readJsonStore<SpeechFile>(this.file, 'speech', isSpeechFile)
      const next = parsed ? normalizeLocalSpeechEndpoint(parsed.endpoint) : ''
      await this.persist(next)
      this.endpoint = next
    })
  }

  get(): string {
    return this.endpoint
  }

  async update(input: string): Promise<string> {
    const endpoint = normalizeLocalSpeechEndpoint(input)
    return this.mutate(async () => {
      await this.persist(endpoint)
      this.endpoint = endpoint
      return endpoint
    })
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation)
    this.mutationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private async persist(endpoint: string): Promise<void> {
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      await writeFile(
        temporary,
        `${JSON.stringify({ version: 1, endpoint } satisfies SpeechFile, null, 2)}\n`,
        'utf8'
      )
      await rename(temporary, this.file)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }
}

function isSpeechFile(value: unknown): value is SpeechFile {
  if (!value || typeof value !== 'object') return false
  const file = value as Partial<SpeechFile>
  if (file.version !== 1 || typeof file.endpoint !== 'string') return false
  try {
    normalizeLocalSpeechEndpoint(file.endpoint)
    return true
  } catch {
    return false
  }
}

export function normalizeLocalSpeechEndpoint(input: string): string {
  const value = input.trim()
  if (!value) return ''

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Enter a valid local transcription URL.')
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const isLoopback =
    hostname === 'localhost' ||
    hostname === '::1' ||
    (isIP(hostname) === 4 && hostname.startsWith('127.'))

  if (
    url.protocol !== 'http:' ||
    !isLoopback ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith('/audio/transcriptions')
  ) {
    throw new Error(
      'Speech transcription must use a local HTTP endpoint ending in /audio/transcriptions (for example, http://127.0.0.1:8080/v1/audio/transcriptions).'
    )
  }

  return url.toString()
}

export async function transcribeLocalAudio(
  endpointInput: string,
  audio: Uint8Array,
  mimeTypeInput: string
): Promise<string> {
  if (audio.byteLength === 0 || audio.byteLength > 25_000_000) {
    throw new Error('The recording is empty or larger than 25 MB.')
  }

  const mimeType = mimeTypeInput.split(';', 1)[0].trim().toLowerCase()
  const extensions: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
    'audio/mp4': 'm4a'
  }
  const extension = extensions[mimeType]
  if (!extension) throw new Error('That recording format is not supported.')

  const endpoint = normalizeLocalSpeechEndpoint(endpointInput)
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), `recording.${extension}`)
  form.append('model', 'whisper-1')
  const response = await fetch(endpoint, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(120_000)
  })

  if (!response.ok) {
    const detail = (await readResponseLimited(response, 64_000)).slice(0, 300)
    throw new Error(`Local transcription returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
  }

  let payload: { text?: unknown }
  try {
    payload = JSON.parse(await readResponseLimited(response, 256_000)) as { text?: unknown }
  } catch (error) {
    if (error instanceof Error && error.message.includes('response exceeded')) throw error
    throw new Error('The local speech service returned an unreadable response.')
  }

  if (typeof payload.text !== 'string' || payload.text.trim().length === 0) {
    throw new Error('The local speech service did not return any transcription text.')
  }
  if (payload.text.length > 30_000) throw new Error('The transcription exceeded the text limit.')
  return payload.text.trim()
}

async function readResponseLimited(response: Response, limit: number): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel()
      throw new Error('The local speech response exceeded its size limit.')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')
}
