import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import { ServiceUnavailableException } from '../../../common/exceptions/index.js'
import { EnvService } from '../../../env/env.service.js'

@Injectable()
export class MfaEncryptionService {
  constructor(private readonly env: EnvService) {}

  private key(id: string): Buffer {
    try {
      const keys: unknown = JSON.parse(this.env.get('MFA_ENCRYPTION_KEYS') ?? '{}')
      if (!keys || typeof keys !== 'object' || Array.isArray(keys) || !(id in keys))
        throw new Error()
      const raw = (keys as Record<string, unknown>)[id]
      if (typeof raw !== 'string') throw new Error()
      const key = Buffer.from(raw, 'base64')
      if (key.length !== 32 || key.toString('base64') !== raw) throw new Error()
      return key
    } catch {
      throw new ServiceUnavailableException('MFA encryption key unavailable')
    }
  }

  assertReady(): void {
    const id = this.env.get('MFA_ACTIVE_KEY_ID')
    if (!id) throw new ServiceUnavailableException('MFA encryption not configured')
    this.key(id)
  }

  encrypt(
    userId: string,
    factorId: string,
    secret: string
  ): { encryptedSeed: string; keyId: string } {
    this.assertReady()
    const keyId = this.env.get('MFA_ACTIVE_KEY_ID')!
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key(keyId), nonce)
    cipher.setAAD(Buffer.from(JSON.stringify(['mfa-seed-v1', userId, factorId])))
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
    return {
      keyId,
      encryptedSeed: Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64'),
    }
  }

  decrypt(userId: string, factorId: string, keyId: string, encryptedSeed: string): string {
    try {
      const packed = Buffer.from(encryptedSeed, 'base64')
      if (packed.length < 29) throw new Error()
      const cipher = createDecipheriv('aes-256-gcm', this.key(keyId), packed.subarray(0, 12))
      cipher.setAAD(Buffer.from(JSON.stringify(['mfa-seed-v1', userId, factorId])))
      cipher.setAuthTag(packed.subarray(12, 28))
      return Buffer.concat([cipher.update(packed.subarray(28)), cipher.final()]).toString('utf8')
    } catch {
      throw new ServiceUnavailableException('MFA factor unavailable')
    }
  }
}
