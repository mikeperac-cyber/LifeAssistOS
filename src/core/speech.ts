import { isIP } from 'node:net'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

interface SpeechFile {
  version: 1
  endpoint: string
}

/** User-configured local transcription endpoint. Remote hosts are rejected. */
export class SpeechSettingsStore {
  private endpoint = ''

  constructor(private readonly file: string) {}

  async init(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true })
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as Partial<SpeechFile>
      if (typeof parsed.endpoint === 'string') this.endpoint = normalizeLocalSpeechEndpoint(parsed.endpoint)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[speech] could not read local transcription settings', error)
      }
    }
    await this.persist()
  }

  get(): string {
    return this.endpoint
  }

  async update(input: string): Promise<string> {
    const endpoint = normalizeLocalSpeechEndpoint(input)
    this.endpoint = endpoint
    await this.persist()
    return endpoint
  }

  private async persist(): Promise<void> {
    const temporary = `${this.file}.tmp`
    await writeFile(
      temporary,
      `${JSON.stringify({ version: 1, endpoint: this.endpoint } satisfies SpeechFile, null, 2)}\n`,
      'utf8'
    )
    await rename(temporary, this.file)
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
