import { describe, expect, it } from 'vitest'
import { prepareChatImageAttachments } from '../src/core/image-attachments'
import {
  MAX_CHAT_IMAGE_ATTACHMENTS,
  MAX_CHAT_IMAGE_BYTES
} from '../src/shared/types'

const validPng = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01
])

function encoded(data: Uint8Array): string {
  return Buffer.from(data).toString('base64')
}

describe('prepareChatImageAttachments', () => {
  it('validates raster bytes and sanitizes renderer-supplied names', () => {
    const result = prepareChatImageAttachments([{
      name: '../family\\photo.png',
      mimeType: 'IMAGE/PNG',
      data: encoded(validPng)
    }])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      name: '.._family_photo.png',
      mimeType: 'image/png',
      size: validPng.length
    })
    expect(result[0].id).toBeTruthy()
    expect(result[0].data).toEqual(validPng)
  })

  it('rejects unsupported formats, spoofed MIME types, and invalid base64', () => {
    expect(() => prepareChatImageAttachments([{
      name: 'vector.svg', mimeType: 'image/svg+xml', data: encoded(validPng)
    }])).toThrow(/PNG, JPEG, or WebP/)
    expect(() => prepareChatImageAttachments([{
      name: 'photo.jpg', mimeType: 'image/jpeg', data: encoded(validPng)
    }])).toThrow(/does not contain a valid JPEG/)
    expect(() => prepareChatImageAttachments([{
      name: 'photo.png', mimeType: 'image/png', data: 'not base64'
    }])).toThrow(/could not be read/)
  })

  it('enforces the per-image and per-message limits before decoding large payloads', () => {
    const tooLarge = 'A'.repeat(Math.ceil(MAX_CHAT_IMAGE_BYTES / 3) * 4 + 4)
    expect(() => prepareChatImageAttachments([{
      name: 'large.png', mimeType: 'image/png', data: tooLarge
    }])).toThrow(/8 MB image limit/)

    const images = Array.from({ length: MAX_CHAT_IMAGE_ATTACHMENTS + 1 }, (_item, index) => ({
      name: `photo-${index}.png`, mimeType: 'image/png', data: encoded(validPng)
    }))
    expect(() => prepareChatImageAttachments(images)).toThrow(/up to 4 images/)
  })
})
