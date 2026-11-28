/** Compact JWT-shaped test data. The signature is a placeholder. */
export function testAccessToken(label: string, expiresAt = Date.now() + 60_000): string {
  const claims = { sub: label, exp: expiresAt / 1000 }
  return `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.c2ln`
}
