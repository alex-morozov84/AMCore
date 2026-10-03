export const MEMBER_MAX_ROLES = 1000
export const MEMBER_REQUEST_BYTES = 262_144
export const MEMBER_RESPONSE_BYTES = 1_048_576
export const MEMBER_API_RESPONSE_BYTES = MEMBER_RESPONSE_BYTES - 128
export const MEMBER_ASSIGNED_BYTES = 524_288

/** Count JSON escaping, punctuation and UTF-8, identically on server and client. */
export function serializedJsonBytes(value: unknown): number {
  let bytes = 0
  for (const character of JSON.stringify(value)) {
    const code = character.codePointAt(0)!
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4
  }
  return bytes
}
