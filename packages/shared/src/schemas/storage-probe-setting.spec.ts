import { describe, expect, it } from 'vitest'

import { storageProbeSettingUpdateSchema } from './storage-probe-setting'

describe('storage probe setting write contract', () => {
  it.each([30, 600, 3600, null])(
    'accepts bounded interval or operator reset %s',
    (intervalSeconds) => {
      expect(
        storageProbeSettingUpdateSchema.parse({ intervalSeconds, expectedRevision: 2147483647 })
      ).toEqual({ intervalSeconds, expectedRevision: 2147483647 })
    }
  )
  it.each([29, 3601, 30.5, '600', undefined, NaN])(
    'rejects an invalid interval %s',
    (intervalSeconds) => {
      expect(
        storageProbeSettingUpdateSchema.safeParse({ intervalSeconds, expectedRevision: 0 }).success
      ).toBe(false)
    }
  )
  it.each([-1, 2147483648, 1.5, '0', undefined])(
    'rejects invalid SQL revision %s',
    (expectedRevision) => {
      expect(
        storageProbeSettingUpdateSchema.safeParse({ intervalSeconds: 600, expectedRevision })
          .success
      ).toBe(false)
    }
  )
  it('rejects extra target/scope keys', () => {
    expect(
      storageProbeSettingUpdateSchema.safeParse({
        intervalSeconds: 600,
        expectedRevision: 0,
        organizationId: 'other',
      }).success
    ).toBe(false)
  })
})
