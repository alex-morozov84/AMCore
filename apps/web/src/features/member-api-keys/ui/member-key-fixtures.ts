import type { MemberKeyList } from '@amcore/shared'
export const memberKeyFixture: MemberKeyList = {
  organization: { id: 'org', name: 'Example organization' },
  member: { memberId: 'member', userId: 'user', name: 'Alex', email: 'alex@example.test' },
  page: 1,
  limit: 20,
  total: 1,
  revocableCount: 1,
  revokeAllLimit: 1000,
  asOf: '2026-10-18T10:00:00.000Z',
  data: [
    {
      id: 'key',
      name: 'Daily export',
      scopes: ['read:Organization'],
      createdAt: '2026-10-17T10:00:00.000Z',
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
      revocationReason: null,
      status: 'unexpired',
    },
  ],
}
