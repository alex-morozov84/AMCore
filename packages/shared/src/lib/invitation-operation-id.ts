/** UUIDv7: a 48-bit epoch timestamp and cryptographically random suffix. */
export function createInvitationOperationId(now = Date.now()): string {
  if (!Number.isSafeInteger(now) || now < 0 || now > 0xffffffffffff)
    throw new RangeError('Invalid UUIDv7 timestamp')
  const crypto = (
    globalThis as typeof globalThis & {
      crypto?: { getRandomValues(array: Uint8Array): Uint8Array }
    }
  ).crypto
  if (!crypto) throw new Error('Cryptographic randomness is unavailable')
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let remaining = now
  for (let i = 5; i >= 0; i--) {
    bytes[i] = remaining % 256
    remaining = Math.floor(remaining / 256)
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
export function invitationOperationTimestamp(id: string): number {
  return Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16)
}
