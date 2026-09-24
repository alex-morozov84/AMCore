import { describe, expect, it } from 'vitest'

import { adminAuditQuerySchema, adminAuditResponseSchema } from './admin-audit'

describe('admin audit wire contract', () => {
  it('defaults to a bounded page and rejects repeated or unknown keys', () => {
    expect(adminAuditQuerySchema.parse({}).limit).toBe(25)
    expect(adminAuditQuerySchema.parse({ limit: '50' }).limit).toBe(50)
    expect(adminAuditQuerySchema.parse({ limit: 50 }).limit).toBe(50)
    for (const input of [
      { limit: ['1', '2'] },
      { actorId: ['a', 'b'] },
      { limit: '51' },
      { limit: '' },
      { sort: 'asc' },
    ]) {
      expect(adminAuditQuerySchema.safeParse(input).success).toBe(false)
    }
  })

  it('rejects unsafe IDs, actions and times', () => {
    for (const input of [
      { actorId: 'x'.repeat(129) },
      { targetId: 'a/b' },
      { action: 'Admin.secret' },
      { cursor: 'x'.repeat(513) },
      { from: '2026-09-23' },
      { to: ['2026-09-23T00:00:00.000Z'] },
    ]) {
      expect(adminAuditQuerySchema.safeParse(input).success).toBe(false)
    }
  })

  it('accepts a bounded action selection and explicit read-event policy', () => {
    expect(
      adminAuditQuerySchema.parse({
        actions: 'admin.cleanup.executed,admin.audit_logs.viewed',
        includeReadEvents: 'false',
      })
    ).toMatchObject({
      actions: ['admin.cleanup.executed', 'admin.audit_logs.viewed'],
      includeReadEvents: false,
    })
    for (const input of [
      { action: 'admin.cleanup.executed', actions: 'admin.audit_logs.viewed' },
      { actions: 'admin.cleanup.executed,admin.cleanup.executed' },
      { actions: Array(11).fill('admin.cleanup.executed').join(',') },
      { includeReadEvents: 'yes' },
    ])
      expect(adminAuditQuerySchema.safeParse(input).success).toBe(false)
  })

  it('strips unlisted response fields at the wire boundary', () => {
    const result = adminAuditResponseSchema.parse({
      items: [
        {
          id: null,
          createdAt: '2026-09-23T00:00:00.000Z',
          actorType: 'SYSTEM',
          actorId: null,
          action: null,
          targetType: null,
          targetId: null,
          organizationId: null,
          category: 'SECURITY',
          summary: {},
          metadata: { secret: 'x' },
        },
      ],
      from: '2026-09-16T00:00:00.000Z',
      to: '2026-09-23T00:00:00.000Z',
      hasMore: false,
      nextCursor: null,
    })
    expect(result.items[0]).not.toHaveProperty('metadata')
  })
})
