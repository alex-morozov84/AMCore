import type { AdminAuditQuery, RequestPrincipal } from '@amcore/shared'

import { BadRequestException } from '../../common/exceptions'

import { AdminAuditService } from './admin-audit.service'

const actor = { sub: 'operator1', type: 'jwt', systemRole: 'SUPER_ADMIN' } as RequestPrincipal
const when = new Date('2026-09-23T10:00:00.000Z')
const query: AdminAuditQuery = {
  from: '2026-09-23T00:00:00.000Z',
  to: '2026-09-23T12:00:00.000Z',
  limit: 1,
}
const hostileId = 'secret/' + 'x'.repeat(10_000)
const row = (id: string, cursorKey: string) => ({
  id,
  cursorKey,
  createdAt: when,
  actorType: 'SYSTEM',
  actorId: null,
  action: 'admin.cleanup.executed',
  targetType: null,
  targetId: null,
  organizationId: null,
  category: 'SECURITY',
  metadata: {},
})

function fixture() {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    auditLog: { findUnique: jest.fn(), findMany: jest.fn() },
    user: { findMany: jest.fn() },
    organization: { findMany: jest.fn() },
  }
  const prisma = {
    $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const env = { get: jest.fn().mockReturnValue('test-secret-longer-than-32-characters') }
  return {
    service: new AdminAuditService(prisma as never, audit as never, env as never),
    tx,
    audit,
    prisma,
  }
}

describe('AdminAuditService', () => {
  it('pages across an unsafe last returned ID and an unsafe lookahead without leaking either', async () => {
    const { service, tx, audit } = fixture()
    const key1 = '00000000-0000-4000-8000-000000000001'
    const key2 = '00000000-0000-4000-8000-000000000002'
    tx.auditLog.findMany
      .mockResolvedValueOnce([row(hostileId, key1), row(hostileId + '2', key2)])
      .mockResolvedValueOnce([row(hostileId + '2', key2)])
    tx.auditLog.findUnique.mockResolvedValue({ id: hostileId, createdAt: when })
    const first = await service.list(query, actor)
    expect(first.items).toHaveLength(1)
    expect(first.items[0]?.id).toBeNull()
    expect(first.nextCursor?.length).toBeLessThanOrEqual(512)
    expect(JSON.stringify(first)).not.toContain(hostileId)
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.audit_logs.viewed',
        metadata: expect.objectContaining({ resultCount: 1 }),
      }),
      { failOpen: false }
    )
    const second = await service.list({ ...query, cursor: first.nextCursor! }, actor)
    expect(second.items).toHaveLength(1)
    expect(second.hasMore).toBe(false)
    expect(second.nextCursor).toBeNull()
    expect(tx.auditLog.findUnique).toHaveBeenCalledWith({
      where: { cursorKey: key1 },
      select: { id: true, createdAt: true },
    })
    expect(tx.auditLog.findMany.mock.calls[1]?.[0]?.where?.AND).toEqual([
      {
        OR: [{ createdAt: { lt: when } }, { createdAt: when, id: { lt: hostileId } }],
      },
    ])
    expect(audit.record).toHaveBeenCalledTimes(2)
  })

  it('deduplicates identity lookups and uses at most two bounded selects', async () => {
    const { service, tx } = fixture()
    tx.auditLog.findMany.mockResolvedValue([
      {
        ...row('event1', '00000000-0000-4000-8000-000000000001'),
        actorType: 'USER',
        actorId: 'user1',
        targetType: 'USER',
        targetId: 'user1',
        organizationId: 'org1',
      },
    ])
    tx.user.findMany.mockResolvedValue([{ id: 'user1', name: 'Current', email: 'u@example.com' }])
    tx.organization.findMany.mockResolvedValue([{ id: 'org1', name: 'Org', slug: 'org' }])
    const result = await service.list(query, actor)
    expect(tx.user.findMany).toHaveBeenCalledTimes(1)
    expect(tx.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['user1'] } },
      select: { id: true, name: true, email: true },
    })
    expect(tx.organization.findMany).toHaveBeenCalledTimes(1)
    expect(result.items[0]?.actorIdentity).toMatchObject({ status: 'current', name: 'Current' })
  })

  it('audits even an empty read, and fails closed when that write fails', async () => {
    const { service, tx, audit } = fixture()
    tx.auditLog.findMany.mockResolvedValue([])
    expect((await service.list(query, actor)).items).toEqual([])
    audit.record.mockRejectedValue(new Error('audit down'))
    await expect(service.list(query, actor)).rejects.toThrow('audit down')
    expect(audit.record).toHaveBeenCalledTimes(2)
  })

  it('rejects a missing cursor anchor and emits no successful-read event', async () => {
    const { service, tx, audit } = fixture()
    tx.auditLog.findMany.mockResolvedValue([
      row('event1', '00000000-0000-4000-8000-000000000001'),
      row('event2', '00000000-0000-4000-8000-000000000002'),
    ])
    const first = await service.list(query, actor)
    audit.record.mockClear()
    tx.auditLog.findUnique.mockResolvedValue(null)
    await expect(service.list({ ...query, cursor: first.nextCursor! }, actor)).rejects.toThrow(
      BadRequestException
    )
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('fails the whole response if enrichment fails', async () => {
    const { service, tx, audit } = fixture()
    tx.auditLog.findMany.mockResolvedValue([
      {
        ...row('event1', '00000000-0000-4000-8000-000000000001'),
        actorType: 'USER',
        actorId: 'user1',
      },
    ])
    tx.user.findMany.mockRejectedValue(new Error('database timeout'))
    await expect(service.list(query, actor)).rejects.toThrow('database timeout')
    expect(audit.record).not.toHaveBeenCalled()
  })
})
