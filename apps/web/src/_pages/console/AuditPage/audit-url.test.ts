import { describe, expect, it } from 'vitest'

import { auditCursorReset, auditHref, auditRowFilter, parseAuditParams } from './audit-url'

describe('Audit URL state', () => {
  it('starts with no known ID and a default bounded page', () => {
    expect(parseAuditParams({})).toMatchObject({ limit: 25 })
  })

  it('rejects repeated, unknown and malformed filters', () => {
    for (const query of [
      { actorId: ['one', 'two'] },
      { sort: 'asc' },
      { cursor: 'x'.repeat(513) },
      { from: 'yesterday' },
    ]) {
      expect(parseAuditParams(query)).toBeNull()
    }
  })

  it('removes a cursor when applying a row filter or resetting it', () => {
    const query = { actorId: 'user1', cursor: 'sealed', limit: 25 }
    expect(auditRowFilter('/admin/audit', query, 'action', 'admin.cleanup.executed')).toBe(
      '/admin/audit?actorId=user1&action=admin.cleanup.executed&limit=25'
    )
    expect(auditCursorReset('/admin/audit', query)).toBe('/admin/audit?actorId=user1&limit=25')
    expect(auditHref('/admin/audit', {})).toBe('/admin/audit')
  })
})
