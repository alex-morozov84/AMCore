import { createHash, randomUUID } from 'node:crypto'

import { MemoryStorageProvider } from './providers/memory-storage.provider.js'
import { FileValidationPipe } from './validation/file-validation.pipe.js'
import { DOCUMENT_VALIDATION } from './validation/file-validation.presets.js'

type ScanResult = { status: 'denied' | 'error' } | { status: 'allowed'; digest: string }
type Recipient = { id: string; canRead: boolean }

const pdfValidation = new FileValidationPipe({
  ...DOCUMENT_VALIDATION,
  allowedMimeTypes: ['application/pdf'],
})

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Private storage and a trusted scanner result, kept local to this example. */
class PdfQuarantine {
  readonly storage = new MemoryStorageProvider()

  private readonly attachments = new Map<string, { recipientId: string; scan?: ScanResult }>()

  async submit(bytes: Buffer, recipientId: string): Promise<string> {
    const { buffer } = await pdfValidation.transform({ buffer: Buffer.from(bytes) })
    const version = `quarantine/${randomUUID()}/original.pdf`
    await this.storage.upload({
      key: version,
      body: buffer,
      contentType: 'application/pdf',
      visibility: 'private',
    })
    this.attachments.set(version, { recipientId })
    return version
  }

  async completeTestScan(version: string, status: ScanResult['status']): Promise<void> {
    const attachment = this.attachments.get(version)
    if (!attachment) throw new Error('Unknown attachment')

    const scan: ScanResult =
      status === 'allowed'
        ? { status, digest: digest(await this.storage.download(version)) }
        : { status }
    attachment.scan = scan
  }

  async download(version: string, recipient: Recipient): Promise<Buffer | undefined> {
    const attachment = this.attachments.get(version)
    if (attachment?.recipientId !== recipient.id || !recipient.canRead) return undefined

    const scan = attachment.scan
    if (scan?.status !== 'allowed') return undefined

    const bytes = await this.storage.download(version)
    return digest(bytes) === scan.digest ? bytes : undefined
  }
}

function blankPdf(): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Resources << >> >>',
  ]
  let pdf = '%PDF-1.4\n'
  const entries = objects.map((object, index) => {
    const entry = `${String(pdf.length).padStart(10, '0')} 00000 n \n`
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
    return entry
  })
  const xref = pdf.length
  pdf += `xref\n0 4\n0000000000 65535 f \n${entries.join('')}`
  pdf += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf)
}

describe('PDF quarantine example', () => {
  const recipient = { id: 'assigned-staff', canRead: true }
  const pdf = blankPdf()

  it('rejects unsupported and oversized uploads before storage', async () => {
    const quarantine = new PdfQuarantine()
    const upload = jest.spyOn(quarantine.storage, 'upload')
    await expect(quarantine.submit(Buffer.from('plain text'), recipient.id)).rejects.toThrow(
      'Invalid file type'
    )
    await expect(
      quarantine.submit(Buffer.alloc(DOCUMENT_VALIDATION.maxSize + 1), recipient.id)
    ).rejects.toThrow('File too large')
    expect(upload).not.toHaveBeenCalled()
  })

  it.each(['pending', 'error', 'denied'] as const)('keeps a %s PDF closed', async (status) => {
    const quarantine = new PdfQuarantine()
    const version = await quarantine.submit(pdf, recipient.id)
    expect(await quarantine.storage.getMetadata(version)).toMatchObject({ visibility: 'private' })
    if (status !== 'pending') await quarantine.completeTestScan(version, status)
    const read = jest.spyOn(quarantine.storage, 'download')

    await expect(quarantine.download(version, recipient)).resolves.toBeUndefined()
    expect(read).not.toHaveBeenCalled()
  })

  it('releases only the approved bytes to the assigned recipient with current rights', async () => {
    const quarantine = new PdfQuarantine()
    const version = await quarantine.submit(pdf, recipient.id)
    await quarantine.completeTestScan(version, 'allowed')

    await expect(quarantine.download(version, recipient)).resolves.toEqual(pdf)
    await expect(
      quarantine.download(version, { id: 'other-staff', canRead: true })
    ).resolves.toBeUndefined()
    await expect(
      quarantine.download(version, { ...recipient, canRead: false })
    ).resolves.toBeUndefined()

    const resubmission = await quarantine.submit(pdf, recipient.id)
    expect(resubmission).not.toBe(version)
    await expect(quarantine.download(resubmission, recipient)).resolves.toBeUndefined()

    await quarantine.storage.upload({
      key: version,
      body: Buffer.concat([pdf, Buffer.from('% replacement\n')]),
      contentType: 'application/pdf',
      visibility: 'private',
    })
    await expect(quarantine.download(version, recipient)).resolves.toBeUndefined()
  })
})
