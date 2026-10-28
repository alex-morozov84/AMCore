import { generateSecret, generateURI, verify } from 'otplib'

export function totpUri(account: string, secret: string): string {
  return generateURI({
    issuer: 'AMCore',
    label: account,
    secret,
    algorithm: 'sha1',
    digits: 6,
    period: 30,
  })
}

export function createTotpSecret(account: string): { secret: string; otpauthUri: string } {
  const secret = generateSecret({ length: 20 })
  return { secret, otpauthUri: totpUri(account, secret) }
}

/** Caller must persist timeStep in the SAME locked transaction as the effect. */
export async function verifyTotp(
  secret: string,
  token: string,
  lastStep: bigint,
  now: Date
): Promise<{ valid: boolean; timeStep?: number }> {
  // A backward clock must fail closed, not reset the counter or throw an SDK range error.
  if (lastStep > BigInt(Math.floor(now.getTime() / 30_000) + 1)) return { valid: false as const }
  return verify({
    secret,
    token,
    algorithm: 'sha1',
    digits: 6,
    period: 30,
    epoch: Math.floor(now.getTime() / 1000),
    epochTolerance: 30,
    ...(lastStep >= 0n ? { afterTimeStep: Number(lastStep) } : {}),
  })
}
