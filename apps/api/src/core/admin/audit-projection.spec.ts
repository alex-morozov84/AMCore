import { projectAuditRow } from './audit-projection'

const row = {
  id: 'c1',
  createdAt: new Date('2026-09-23T00:00:00.000Z'),
  actorType: 'USER' as const,
  actorId: 'user1',
  action: 'admin.user.system_role_changed',
  targetType: 'USER' as const,
  targetId: 'user1',
  organizationId: null,
  category: 'SECURITY' as const,
  metadata: { beforeSystemRole: 'USER', afterSystemRole: 'SUPER_ADMIN', secret: 'never' },
}

describe('audit read projection', () => {
  it('projects only bounded runtime interval and revision metadata', () => {
    const metadata = {
      beforeIntervalSeconds: null,
      afterIntervalSeconds: 60,
      beforeRevision: 0,
      afterRevision: 1,
      value: 'never expose generic values',
    }
    const item = projectAuditRow(
      {
        ...row,
        action: 'admin.runtime_setting.changed',
        metadata,
        targetType: 'RUNTIME_SETTING',
        targetId: 'storage_probe',
      },
      new Map(),
      new Map()
    )
    expect(item.summary).toEqual({
      beforeIntervalSeconds: null,
      afterIntervalSeconds: 60,
      beforeRevision: 0,
      afterRevision: 1,
    })
    expect(JSON.stringify(item)).not.toContain('never expose')
    expect(
      projectAuditRow(
        {
          ...row,
          action: 'admin.runtime_setting.changed',
          metadata: { ...metadata, afterRevision: 2147483648 },
        },
        new Map(),
        new Map()
      ).summary
    ).toEqual({})
  })
  it('returns only current safe identity and selected role codes', () => {
    const item = projectAuditRow(
      row,
      new Map([
        [
          'user1',
          {
            id: 'user1',
            name: 'Current Name',
            email: 'current@example.com',
          },
        ],
      ]),
      new Map()
    )
    expect(item.actorIdentity).toEqual({
      status: 'current',
      name: 'Current Name',
      email: 'current@example.com',
    })
    expect(item.summary).toEqual({ beforeSystemRole: 'USER', afterSystemRole: 'SUPER_ADMIN' })
    expect(JSON.stringify(item)).not.toContain('never')
  })

  it('keeps a hostile old row in the response without exposing its IDs or metadata', () => {
    const hostile = 'secret/' + 'x'.repeat(10_000)
    const item = projectAuditRow(
      { ...row, id: hostile, actorId: hostile, action: hostile, metadata: { token: hostile } },
      new Map(),
      new Map()
    )
    expect(item.id).toBeNull()
    expect(item.actorId).toBeNull()
    expect(item.action).toBeNull()
    expect(item.summary).toEqual({})
    expect(JSON.stringify(item)).not.toContain(hostile)
  })

  it('does not mistake a missing current record for a historical identity', () => {
    const item = projectAuditRow(row, new Map(), new Map())
    expect(item.actorIdentity).toEqual({ status: 'not_found' })
    expect(item.targetIdentity).toEqual({ status: 'not_found' })
  })
})
