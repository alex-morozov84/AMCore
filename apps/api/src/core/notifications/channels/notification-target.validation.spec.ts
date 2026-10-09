import { validateNotificationTargets } from './notification-target.validation'
describe('Channel target registration boundary', () => {
  it('accepts exactly the supported multi-subscription bound', () => {
    expect(() =>
      validateNotificationTargets(
        Array.from({ length: 100 }, (_, i) => ({ targetKey: `target-${i}` }))
      )
    ).not.toThrow()
  })
  it('refuses excess, duplicate or oversized destinations rather than truncate work', () => {
    expect(() =>
      validateNotificationTargets(
        Array.from({ length: 101 }, (_, i) => ({ targetKey: `target-${i}` }))
      )
    ).toThrow()
    expect(() =>
      validateNotificationTargets([{ targetKey: 'same' }, { targetKey: 'same' }])
    ).toThrow()
    expect(() =>
      validateNotificationTargets([
        { targetKey: 'target', destinationSnapshot: { text: 'Ж'.repeat(2500) } },
      ])
    ).toThrow()
    expect(() =>
      validateNotificationTargets([
        { targetKey: 'target', destinationSnapshot: { missing: undefined } as never },
      ])
    ).toThrow()
  })
})
