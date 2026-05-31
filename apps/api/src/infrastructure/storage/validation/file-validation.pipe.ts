import { HttpStatus, Injectable, type PipeTransform } from '@nestjs/common'

import { AppException, BadRequestException } from '../../../common/exceptions'

/** Minimal shape of an in-memory (Multer) upload the pipe validates. */
export interface ValidatableFile {
  buffer: Buffer
}

export interface FileValidationOptions {
  /** Hard byte ceiling for this route. Measured against the actual buffer. */
  maxSize: number
  /** Allowed MIME types, matched against magic-byte detection (never the header). */
  allowedMimeTypes: string[]
  /**
   * Content-Disposition policy a consumer should apply when serving this class
   * of file: `attachment` for user documents (never render inline), `inline`
   * for safe raster images. Advisory only — the pipe validates bytes, it does
   * not serve content; the upload/download consumer reads this.
   */
  contentDisposition?: 'attachment' | 'inline'
}

/**
 * Server-side upload validation. Order: size first (cheap), then MIME via magic
 * bytes. The client-supplied `Content-Type`/filename is NEVER trusted — only the
 * actual bytes decide the type. SVG is rejected by every image preset (magic
 * bytes can't safely identify it and inline SVG is a stored-XSS vector).
 *
 * Server-side validated upload is the safe default; presigned direct upload
 * (bytes go client -> provider, unseen by the server) is out of scope.
 */
@Injectable()
export class FileValidationPipe implements PipeTransform<
  ValidatableFile,
  Promise<ValidatableFile>
> {
  constructor(private readonly options: FileValidationOptions) {}

  async transform(file: ValidatableFile): Promise<ValidatableFile> {
    if (!file?.buffer) {
      throw new BadRequestException('File is required')
    }

    // Authoritative size is the real byte length, not any client-reported value.
    const size = file.buffer.length
    if (size > this.options.maxSize) {
      throw new AppException(
        `File too large: ${size} bytes (max: ${this.options.maxSize})`,
        HttpStatus.PAYLOAD_TOO_LARGE,
        'FILE_TOO_LARGE'
      )
    }

    // `file-type` is ESM-only — dynamic import keeps it loadable from CommonJS
    // NestJS (Node's require-of-ESM also covers the compiled `require` form).
    const { fileTypeFromBuffer } = await import('file-type')
    const detected = await fileTypeFromBuffer(file.buffer)
    if (!detected || !this.options.allowedMimeTypes.includes(detected.mime)) {
      throw new BadRequestException(
        `Invalid file type: ${detected?.mime ?? 'unknown'}. Allowed: ${this.options.allowedMimeTypes.join(', ')}`
      )
    }

    return file
  }
}
