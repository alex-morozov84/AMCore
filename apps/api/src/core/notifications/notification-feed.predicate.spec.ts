import { inAppFeedWhere } from './notification-feed.predicate'

describe('inAppFeedWhere', () => {
  it('requires the recipient, non-archived and a DELIVERED in_app delivery', () => {
    expect(inAppFeedWhere('user-1')).toEqual({
      AND: [
        {
          recipientUserId: 'user-1',
          archivedAt: null,
          deliveries: { some: { channel: 'in_app', status: 'DELIVERED' } },
        },
      ],
    })
  })

  it('ANDs extra conditions AFTER the base so they can never override it', () => {
    const where = inAppFeedWhere('user-1', { readAt: null }, { id: 'n1' })
    expect(where.AND).toHaveLength(3)
    expect((where.AND as unknown[])[0]).toMatchObject({
      recipientUserId: 'user-1',
      archivedAt: null,
    })
    expect((where.AND as unknown[]).slice(1)).toEqual([{ readAt: null }, { id: 'n1' }])
  })

  it('does not let a hostile condition replace the recipient or eligibility', () => {
    // A condition naming the same keys is a SEPARATE AND member — both must hold.
    const where = inAppFeedWhere('user-1', {
      recipientUserId: 'someone-else',
      archivedAt: { not: null },
    })
    const members = where.AND as Array<Record<string, unknown>>
    expect(members[0]).toMatchObject({ recipientUserId: 'user-1', archivedAt: null })
    expect(members[1]).toEqual({ recipientUserId: 'someone-else', archivedAt: { not: null } })
  })
})
