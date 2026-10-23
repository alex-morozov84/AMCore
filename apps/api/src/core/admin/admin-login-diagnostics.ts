import type { AdminUserDetailResponse } from '@amcore/shared'

import type { OAuthProvider, Prisma } from '../../generated/prisma/client.js'

type Diagnostics = AdminUserDetailResponse['loginDiagnostics']

const PROVIDERS = {
  GOOGLE: 'google',
  GITHUB: 'github',
  APPLE: 'apple',
  TELEGRAM: 'telegram',
} as const satisfies Record<OAuthProvider, Diagnostics['linkedProviders'][number]>

/** Read setup facts without materializing password hashes or provider credentials. */
export async function readLoginDiagnostics(
  tx: Prisma.TransactionClient,
  userId: string
): Promise<Diagnostics> {
  const [passwordCount, providers] = await Promise.all([
    tx.user.count({
      where: { id: userId, passwordHash: { not: null }, NOT: { passwordHash: '' } },
    }),
    tx.oAuthAccount.groupBy({
      by: ['provider'],
      where: { userId },
      orderBy: { provider: 'asc' },
    }),
  ])
  return {
    hasPassword: passwordCount > 0,
    linkedProviders: providers.map(({ provider }) => PROVIDERS[provider]),
  }
}
