import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export function createHmacHex(secret: string, payload: Buffer | string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

export function constantTimeEquals(actual: string, expected: string): boolean {
  const actualDigest = createHash('sha256').update(actual).digest()
  const expectedDigest = createHash('sha256').update(expected).digest()
  return timingSafeEqual(actualDigest, expectedDigest)
}
