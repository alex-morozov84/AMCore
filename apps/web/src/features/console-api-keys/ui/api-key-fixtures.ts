import type { AdminApiKey } from '@amcore/shared'

export const API_KEY_FIXTURES: AdminApiKey[] = ['unexpired', 'expired', 'revoked'].map(
  (status, index) => ({
    id: `cm12345678901234567890123${index}`,
    name: ['Reporting integration', 'Legacy importer', 'Compromised key'][index]!,
    status: status as AdminApiKey['status'],
    scopes: ['read:User', 'read:Organization'],
    owner: { id: 'cm123456789012345678901240', name: 'Demo owner', email: 'owner@example.test' },
    organization: { id: 'cm123456789012345678901241', name: 'Demo organization', slug: 'demo' },
    createdAt: '2026-09-01T12:00:00.000Z',
    lastUsedAt: index === 0 ? '2026-09-29T06:00:00.000Z' : null,
    expiresAt: index === 1 ? '2026-09-20T12:00:00.000Z' : null,
    revokedAt: index === 2 ? '2026-09-28T12:00:00.000Z' : null,
    revocationReason: index === 2 ? 'platform_revoked' : null,
  })
)
