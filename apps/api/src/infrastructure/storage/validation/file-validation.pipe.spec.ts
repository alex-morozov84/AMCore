import { HttpStatus } from '@nestjs/common'

import { AppException, BadRequestException } from '../../../common/exceptions'

import { FileValidationPipe, type ValidatableFile } from './file-validation.pipe'
import { AVATAR_VALIDATION, DOCUMENT_VALIDATION, IMAGE_VALIDATION } from './file-validation.presets'

// `file-type` is ESM-only; Jest's CJS runtime can't load it (repo precedent:
// ESM deps like @formatjs/intl are mocked under Jest). This mock mirrors the
// real library's magic-byte output for the sample bodies below (verified
// against file-type v22). Real file-type runs in production.
jest.mock('file-type', () => ({
  __esModule: true,
  fileTypeFromBuffer: async (buf: Buffer) => {
    const at = (i: number, b: number): boolean => buf[i] === b
    const ascii = (start: number, end: number): string =>
      buf.subarray(start, end).toString('latin1')
    if (at(0, 0x89) && at(1, 0x50) && at(2, 0x4e) && at(3, 0x47))
      return { ext: 'png', mime: 'image/png' }
    if (at(0, 0xff) && at(1, 0xd8) && at(2, 0xff)) return { ext: 'jpg', mime: 'image/jpeg' }
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP')
      return { ext: 'webp', mime: 'image/webp' }
    if (ascii(0, 3) === 'GIF') return { ext: 'gif', mime: 'image/gif' }
    if (ascii(0, 5) === '%PDF-') return { ext: 'pdf', mime: 'application/pdf' }
    if (at(0, 0x4d) && at(1, 0x5a)) return { ext: 'exe', mime: 'application/x-msdownload' }
    return undefined // unknown / SVG / plain text
  },
}))

// Magic-byte sample bodies (real bytes — `file-type` detection runs for real).
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]),
  Buffer.alloc(16),
])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
])
const GIF = Buffer.from('GIF89a' + '.'.repeat(16))
const PDF = Buffer.from('%PDF-1.4\n%binary\n')
// `<?xml ...><svg>` → file-type reports application/xml; bare <svg> → undefined.
const SVG = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>')
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)])

const file = (buffer: Buffer): ValidatableFile => ({ buffer })

describe('FileValidationPipe', () => {
  describe('basic guards', () => {
    const pipe = new FileValidationPipe(IMAGE_VALIDATION)

    it('rejects a missing file', async () => {
      await expect(pipe.transform(undefined as unknown as ValidatableFile)).rejects.toBeInstanceOf(
        BadRequestException
      )
    })

    it('rejects an oversize file with 413', async () => {
      const tiny = new FileValidationPipe({ maxSize: 8, allowedMimeTypes: ['image/png'] })
      const err = await tiny.transform(file(PNG)).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(AppException)
      expect((err as AppException).getStatus()).toBe(HttpStatus.PAYLOAD_TOO_LARGE)
    })
  })

  describe('magic-byte MIME detection (header is never trusted)', () => {
    const pipe = new FileValidationPipe(IMAGE_VALIDATION)

    it.each([
      ['png', PNG],
      ['jpeg', JPEG],
      ['webp', WEBP],
      ['gif', GIF],
    ])('accepts a valid %s under the image preset', async (_label, buffer) => {
      const input = file(buffer)
      await expect(pipe.transform(input)).resolves.toBe(input)
    })

    it('rejects SVG in the image preset (magic bytes / stored-XSS)', async () => {
      await expect(pipe.transform(file(SVG))).rejects.toBeInstanceOf(BadRequestException)
    })

    it('rejects an EXE body regardless of any (spoofed) png content-type', async () => {
      await expect(pipe.transform(file(EXE))).rejects.toBeInstanceOf(BadRequestException)
    })

    it('rejects an undetectable body (plain text)', async () => {
      await expect(pipe.transform(file(Buffer.from('not a real file')))).rejects.toBeInstanceOf(
        BadRequestException
      )
    })
  })

  describe('preset narrowing', () => {
    it('avatar preset rejects gif but accepts png', async () => {
      const pipe = new FileValidationPipe(AVATAR_VALIDATION)
      await expect(pipe.transform(file(GIF))).rejects.toBeInstanceOf(BadRequestException)
      await expect(pipe.transform(file(PNG))).resolves.toEqual(file(PNG))
    })

    it('document preset accepts pdf', async () => {
      const pipe = new FileValidationPipe(DOCUMENT_VALIDATION)
      await expect(pipe.transform(file(PDF))).resolves.toEqual(file(PDF))
    })
  })

  describe('preset shapes', () => {
    it('image/avatar presets exclude svg and set inline disposition', () => {
      expect(IMAGE_VALIDATION.allowedMimeTypes).not.toContain('image/svg+xml')
      expect(AVATAR_VALIDATION.allowedMimeTypes).not.toContain('image/svg+xml')
      expect(IMAGE_VALIDATION.contentDisposition).toBe('inline')
    })

    it('document preset forces attachment disposition', () => {
      expect(DOCUMENT_VALIDATION.contentDisposition).toBe('attachment')
    })
  })
})
