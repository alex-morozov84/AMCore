import assert from 'node:assert/strict'
import { test } from 'node:test'

import { base32Decode, totp } from './operator-totp.mjs'

// RFC 6238 appendix B, HMAC-SHA1, secret "12345678901234567890" (8-digit values; we use the last 6).
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

test('base32 decodes the RFC secret and ignores spaces, case and padding', () => {
  assert.equal(base32Decode(SECRET).toString('ascii'), '12345678901234567890')
  assert.equal(
    base32Decode('gezd gnbv-GY3T QOJQ GEZD GNBV GY3T QOJQ==').toString('ascii'),
    '12345678901234567890'
  )
  assert.throws(() => base32Decode('not*base32'), /not base32/)
})

for (const [seconds, expected] of [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
]) {
  test(`code at ${seconds} s matches the RFC value`, () => {
    assert.equal(totp(SECRET, seconds * 1000).code, expected)
  })
}

test('seconds left counts down inside a 30-second step', () => {
  assert.equal(totp(SECRET, 30_000).secondsLeft, 30)
  assert.equal(totp(SECRET, 59_000).secondsLeft, 1)
})
