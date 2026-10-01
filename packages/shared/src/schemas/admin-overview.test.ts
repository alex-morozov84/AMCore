import { describe, expect, it } from 'vitest'

import { adminOverviewFilesystemSchema, adminOverviewPoolSchema } from './admin-overview'

const filesystem = {
  status: 'available',
  sampledAt: '2026-09-30T12:00:00.000Z',
  path: '/',
  totalBytes: 100,
  availableBytes: 10,
  pressureRatio: 0.9,
  pressureThreshold: 0.9,
}

describe('Overview resource wire safety', () => {
  it.each([NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1])('rejects unsafe bytes %p', (value) => {
    expect(
      adminOverviewFilesystemSchema.safeParse({ ...filesystem, totalBytes: value }).success
    ).toBe(false)
  })
  it('rejects available capacity greater than total', () => {
    expect(
      adminOverviewFilesystemSchema.safeParse({ ...filesystem, availableBytes: 101 }).success
    ).toBe(false)
  })
  it('accepts equality at the disk threshold without inventing down status', () => {
    expect(adminOverviewFilesystemSchema.parse(filesystem)).toEqual(filesystem)
  })
  it('requires a null timestamp when measurement is unavailable', () => {
    expect(
      adminOverviewPoolSchema.safeParse({ status: 'unavailable', sampledAt: filesystem.sampledAt })
        .success
    ).toBe(false)
    expect(adminOverviewPoolSchema.parse({ status: 'unavailable', sampledAt: null })).toEqual({
      status: 'unavailable',
      sampledAt: null,
    })
  })
})
