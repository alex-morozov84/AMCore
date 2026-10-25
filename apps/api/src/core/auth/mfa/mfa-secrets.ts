import { createHash, randomBytes } from 'node:crypto'

/** Fixed-length opaque credentials; never use these as an access JWT. */
export function mfaCredential(): string {
  return randomBytes(32).toString('base64url')
}

export function mfaHash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function backupCodeHash(userId: string, generation: number, code: string): string {
  const normalized = code.replaceAll('-', '').toUpperCase()
  return mfaHash(JSON.stringify(['mfa-backup-v1', userId, generation, normalized]))
}

export function generateBackupCodes(): string[] {
  return Array.from({ length: 10 }, () =>
    randomBytes(16).toString('hex').toUpperCase().match(/.{4}/g)!.join('-')
  )
}
