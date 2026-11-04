import { randomUUID } from 'node:crypto'
import {
  CHAT_IMAGE_MIME_TYPES,
  MAX_CHAT_IMAGE_ATTACHMENTS,
  MAX_CHAT_IMAGE_BYTES,
  MAX_CHAT_IMAGE_TOTAL_BYTES,
  type ChatImageAttachment,
  type ChatImageAttachmentInput
} from '../shared/types'

const ALLOWED_IMAGE_TYPES = new Set<string>(CHAT_IMAGE_MIME_TYPES)

export interface StoredChatImageAttachment extends ChatImageAttachment {
  data: Uint8Array
}

/** Validates untrusted renderer data before it enters local chat storage or a provider request. */
export function prepareChatImageAttachments(input: unknown): StoredChatImageAttachment[] {
  if (input === undefined) return []
  if (!Array.isArray(input)) throw new Error('Image attachments must be sent as a list.')
  if (input.length > MAX_CHAT_IMAGE_ATTACHMENTS) {
    throw new Error(`Attach up to ${MAX_CHAT_IMAGE_ATTACHMENTS} images per message.`)
  }

  let totalBytes = 0
  const attachments: StoredChatImageAttachment[] = []

  for (const value of input as unknown[]) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('One of the image attachments is invalid.')
    }
    const candidate = value as Partial<ChatImageAttachmentInput>
    if (typeof candidate.mimeType !== 'string' || candidate.mimeType.length > 32) {
      throw new Error('Use PNG, JPEG, or WebP images.')
    }
    const mimeType = candidate.mimeType.toLowerCase()
    const name = cleanImageName(candidate.name)
    const encoded = candidate.data

    if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
      throw new Error('Use PNG, JPEG, or WebP images.')
    }
    if (typeof encoded !== 'string' || encoded.length === 0) {
      throw new Error('One of the image files could not be read. Please attach it again.')
    }

    const maximumEncodedLength = Math.ceil(MAX_CHAT_IMAGE_BYTES / 3) * 4
    if (encoded.length > maximumEncodedLength) {
      throw new Error(`${name} is larger than the 8 MB image limit.`)
    }
    if (encoded.length % 4 !== 0) {
      throw new Error('One of the image files could not be read. Please attach it again.')
    }

    const data = Buffer.from(encoded, 'base64')
    if (data.length === 0 || data.length > MAX_CHAT_IMAGE_BYTES) {
      throw new Error(`${name} is larger than the 8 MB image limit or is empty.`)
    }
    if (data.toString('base64') !== encoded) {
      throw new Error(`${name} is not valid base64 image data.`)
    }
    if (!matchesImageType(data, mimeType)) {
      throw new Error(`${name} does not contain a valid ${labelForMime(mimeType)} image.`)
    }

    totalBytes += data.length
    if (totalBytes > MAX_CHAT_IMAGE_TOTAL_BYTES) {
      throw new Error('Images in one message must total 16 MB or less.')
    }

    attachments.push({
      id: randomUUID(),
      name,
      mimeType: mimeType as ChatImageAttachment['mimeType'],
      size: data.length,
      data: new Uint8Array(data)
    })
  }

  return attachments
}

function cleanImageName(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    throw new Error('One of the image files has an invalid name.')
  }
  const name = value
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
    .trim()
    .slice(0, 120)
  return name || 'image'
}

function matchesImageType(data: Uint8Array, mimeType: string): boolean {
  if (mimeType === 'image/png') {
    return data.length >= 24 &&
      data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47 &&
      data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a
  }
  if (mimeType === 'image/jpeg') {
    return data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
  }
  return mimeType === 'image/webp' && data.length >= 16 &&
    asciiAt(data, 0, 'RIFF') && asciiAt(data, 8, 'WEBP')
}

function asciiAt(data: Uint8Array, offset: number, value: string): boolean {
  return [...value].every((character, index) => data[offset + index] === character.charCodeAt(0))
}

function labelForMime(mimeType: string): string {
  return mimeType === 'image/jpeg' ? 'JPEG' : mimeType === 'image/webp' ? 'WebP' : 'PNG'
}
