import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { normalizeLocalSpeechEndpoint, SpeechSettingsStore, transcribeLocalAudio } from '../src/core/speech'

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-speech-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('local speech endpoint', () => {
  it('keeps the active endpoint unchanged when saving an update fails', async () => {
    const file = path.join(dir, 'speech.json')
    const store = new SpeechSettingsStore(file)
    await store.init()
    await rm(file)
    await mkdir(file)

    await expect(store.update('http://127.0.0.1:8080/v1/audio/transcriptions')).rejects.toBeDefined()

    expect(store.get()).toBe('')
  })

  it('accepts local IPv4 and localhost transcription endpoints', () => {
    expect(normalizeLocalSpeechEndpoint('http://127.0.0.1:8080/v1/audio/transcriptions'))
      .toBe('http://127.0.0.1:8080/v1/audio/transcriptions')
    expect(normalizeLocalSpeechEndpoint('http://localhost:8080/v1/audio/transcriptions'))
      .toBe('http://localhost:8080/v1/audio/transcriptions')
  })

  it('rejects remote, HTTPS, credentialed, and unrelated local endpoints', () => {
    expect(() => normalizeLocalSpeechEndpoint('https://example.com/v1/audio/transcriptions')).toThrow(/local HTTP/i)
    expect(() => normalizeLocalSpeechEndpoint('http://192.168.1.4:8080/v1/audio/transcriptions')).toThrow(/local HTTP/i)
    expect(() => normalizeLocalSpeechEndpoint('http://user:pass@127.0.0.1:8080/v1/audio/transcriptions')).toThrow(/local HTTP/i)
    expect(() => normalizeLocalSpeechEndpoint('http://127.0.0.1:8080/other')).toThrow(/local HTTP/i)
  })

  it('persists and clears the local endpoint', async () => {
    const file = path.join(dir, 'speech.json')
    const store = new SpeechSettingsStore(file)
    await store.init()
    await store.update('http://127.0.0.1:8080/v1/audio/transcriptions')

    const reloaded = new SpeechSettingsStore(file)
    await reloaded.init()
    expect(reloaded.get()).toContain('/audio/transcriptions')
    await reloaded.update('')
    const cleared = new SpeechSettingsStore(file)
    await cleared.init()
    expect(cleared.get()).toBe('')
  })

  it('sends audio only to a loopback transcription endpoint and reads the transcript', async () => {
    let requestBody = ''
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        requestBody = Buffer.concat(chunks).toString('utf8')
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ text: 'local words here' }))
      })
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    try {
      const text = await transcribeLocalAudio(
        `http://127.0.0.1:${port}/v1/audio/transcriptions`,
        new Uint8Array([1, 2, 3, 4]),
        'audio/webm;codecs=opus'
      )

      expect(text).toBe('local words here')
      expect(requestBody).toContain('name="model"')
      expect(requestBody).toContain('whisper-1')
      expect(requestBody).toContain('recording.webm')
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
