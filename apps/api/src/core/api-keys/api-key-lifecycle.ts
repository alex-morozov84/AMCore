import type { Prisma } from '@/generated/prisma/client'

/** Metadata becomes purge-eligible thirty days after its first terminal moment. */
export const API_KEY_TERMINAL_RETENTION_DAYS = 30

export function apiKeyStatus(
  key: { revokedAt: Date | null; expiresAt: Date | null },
  now: Date
): 'revoked' | 'expired' | 'unexpired' {
  if (key.revokedAt) return 'revoked'
  return key.expiresAt && key.expiresAt <= now ? 'expired' : 'unexpired'
}

export function staleTerminalApiKeyWhere(now: Date): Prisma.ApiKeyWhereInput {
  const cutoff = new Date(now.getTime() - API_KEY_TERMINAL_RETENTION_DAYS * 86_400_000)
  return { OR: [{ revokedAt: { lte: cutoff } }, { expiresAt: { lte: cutoff } }] }
}

export function apiKeyStatusWhere(
  status: 'all' | 'unexpired' | 'expired' | 'revoked',
  now: Date
): Prisma.ApiKeyWhereInput {
  if (status === 'revoked') return { revokedAt: { not: null } }
  if (status === 'expired') return { revokedAt: null, expiresAt: { lte: now } }
  if (status === 'unexpired')
    return { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }
  return {}
}
