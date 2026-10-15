import { S3Client } from '@aws-sdk/client-s3'

/**
 * Connection settings shared by every S3 client the application builds (the
 * storage driver, its presign client and the active file check). One factory keeps
 * addressing, credentials, checksum mode and transport limits from drifting apart.
 */
export interface S3ClientSettings {
  region: string
  accessKeyId: string
  secretAccessKey: string
  /** SDK endpoint (may be internal/Docker). Omit for AWS. */
  endpoint?: string
  forcePathStyle?: boolean
}

export interface S3ClientOptions {
  /** Override the SDK endpoint, e.g. the browser-facing origin used only to presign. */
  endpoint?: string
  /** Total attempts including the first request; the SDK default is used when omitted. */
  maxAttempts?: number
}

/** TCP/TLS connect budget. A dead endpoint should fail fast, not hold a request slot. */
export const S3_CONNECTION_TIMEOUT_MS = 5_000
/** Socket idle budget between bytes; large uploads stay alive while data keeps flowing. */
export const S3_SOCKET_IDLE_TIMEOUT_MS = 60_000

/**
 * Build an S3 client.
 *
 * Checksum calculation and validation are `WHEN_REQUIRED`: with the SDK defaults the
 * client adds `x-amz-checksum-*` headers that some S3-compatible providers reject, and a
 * presigned PUT carries a checksum of an empty body (HTTP 400 measured on SeaweedFS
 * and Garage).
 */
export function createS3Client(
  settings: S3ClientSettings,
  options: S3ClientOptions = {}
): S3Client {
  return new S3Client({
    region: settings.region,
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
    },
    endpoint: options.endpoint ?? (settings.endpoint || undefined),
    forcePathStyle: settings.forcePathStyle ?? false,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    requestHandler: {
      connectionTimeout: S3_CONNECTION_TIMEOUT_MS,
      requestTimeout: S3_SOCKET_IDLE_TIMEOUT_MS,
    },
    ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
  })
}
