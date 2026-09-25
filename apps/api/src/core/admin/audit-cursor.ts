import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto'

import type { AdminAuditQuery } from '@amcore/shared'

import { BadRequestException } from '../../common/exceptions'

const PURPOSE = 'amcore:admin-audit-cursor:v1'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const BASE64URL = /^[A-Za-z0-9_-]+$/

type Filters = Pick<
  AdminAuditQuery,
  | 'actorId'
  | 'actorType'
  | 'action'
  | 'actions'
  | 'targetId'
  | 'targetType'
  | 'organizationId'
  | 'includeReadEvents'
>

export interface AuditCursorScope {
  operatorId: string
  from: string
  to: string
  filters: Filters
}

function digest(filters: Filters): string {
  const values = [
    filters.actorId,
    filters.actorType,
    filters.action,
    filters.actions?.slice().sort(),
    filters.targetId,
    filters.targetType,
    filters.organizationId,
    !!filters.includeReadEvents,
  ]
  return createHash('sha256').update(JSON.stringify(values)).digest('base64url')
}

export class AuditCursorCodec {
  private readonly key: Buffer

  constructor(secret: string) {
    this.key = Buffer.from(hkdfSync('sha256', secret, PURPOSE, 'cursor-seal', 32))
  }

  seal(cursorKey: string, scope: AuditCursorScope): string {
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce)
    cipher.setAAD(Buffer.from(`${PURPOSE}:${scope.operatorId}`))
    const payload = JSON.stringify([1, cursorKey, scope.from, scope.to, digest(scope.filters)])
    const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()])
    const token = Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64url')
    if (token.length > 512) throw new Error('Audit cursor exceeded size bound')
    return token
  }

  open(token: string, scope: AuditCursorScope): string {
    if (token.length > 512 || !BASE64URL.test(token))
      throw new BadRequestException('Invalid cursor')
    try {
      const bytes = Buffer.from(token, 'base64url')
      if (bytes.toString('base64url') !== token || bytes.length < 29) throw Error()
      const decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12))
      decipher.setAAD(Buffer.from(`${PURPOSE}:${scope.operatorId}`))
      decipher.setAuthTag(bytes.subarray(12, 28))
      const value: unknown = JSON.parse(
        Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')
      )
      if (
        !Array.isArray(value) ||
        value.length !== 5 ||
        value[0] !== 1 ||
        typeof value[1] !== 'string' ||
        !UUID.test(value[1]) ||
        value[2] !== scope.from ||
        value[3] !== scope.to ||
        value[4] !== digest(scope.filters)
      )
        throw Error()
      return value[1]
    } catch {
      throw new BadRequestException('Invalid cursor')
    }
  }
}
