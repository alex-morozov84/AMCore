import { afterEach, describe, expect, it } from 'vitest'

import { ADMIN_CONSOLE_CONFIG } from './admin-console.generated'
import {
  getConsoleAuditHref,
  getConsoleDetailAuditHref,
  getConsoleOrganizationsHref,
  getConsoleOverviewHref,
  getConsoleUserDetailHref,
  getConsoleUsersHref,
  parseConsoleReturnHref,
} from './console-public-href'

const mutableConfig = ADMIN_CONSOLE_CONFIG as unknown as {
  mode: 'disabled' | 'path' | 'host'
  slug: string
}
const originalMode = ADMIN_CONSOLE_CONFIG.mode
const originalSlug = ADMIN_CONSOLE_CONFIG.slug

afterEach(() => {
  mutableConfig.mode = originalMode
  mutableConfig.slug = originalSlug
})

describe('detail return addresses', () => {
  it('opens identity activity for the full 31-day Audit interval', () => {
    mutableConfig.mode = 'path'
    mutableConfig.slug = 'operations'
    const now = Date.parse('2026-09-25T12:00:00.000Z')
    const href = getConsoleDetailAuditHref({ actorId: 'user1' }, now)
    const url = new URL(href, 'http://console.invalid')
    expect(url.pathname).toBe('/operations/audit')
    expect(url.searchParams.get('actorId')).toBe('user1')
    expect(url.searchParams.get('from')).toBe('2026-08-25T12:00:00.000Z')
    expect(url.searchParams.get('to')).toBe('2026-09-25T12:00:00.000Z')
    expect(parseConsoleReturnHref(`${url.pathname}${url.search}`)).toBe(
      `${url.pathname}${url.search}`
    )
  })
  it('preserves exact inventory and audit query state in path mode', () => {
    mutableConfig.mode = 'path'
    mutableConfig.slug = 'operations'
    const audit = '/operations/audit?cursor=next&actorId=user1'
    expect(parseConsoleReturnHref(audit)).toBe(audit)
    expect(parseConsoleReturnHref('/operations/users?page=10&search=alex')).toBe(
      '/operations/users?page=10&search=alex'
    )
    expect(getConsoleUserDetailHref('user1', audit)).toBe(
      `/operations/users/user1?${new URLSearchParams({ returnTo: audit })}`
    )
  })

  it('rejects external, encoded, malformed and wrong-route sources', () => {
    mutableConfig.mode = 'path'
    mutableConfig.slug = 'operations'
    for (const value of [
      '//evil.test/operations/users',
      'https://evil.test/operations/users',
      '/%2f%2fevil.test/operations/users',
      '/operations/users/user1',
      '/operations/users?page=1&page=2',
      '/operations/users?unknown=1',
      '/operations/users#fragment',
      '/operations/users\\evil.test',
      '/operations/users?' + 'x'.repeat(2048),
    ]) {
      expect(parseConsoleReturnHref(value)).toBeNull()
    }
  })

  it('uses only host-root paths in host mode', () => {
    mutableConfig.mode = 'host'
    expect(parseConsoleReturnHref('/audit?cursor=next')).toBe('/audit?cursor=next')
    expect(parseConsoleReturnHref('/operations/audit')).toBeNull()
  })
})

describe('getConsoleOverviewHref', () => {
  it('uses the generated slug in path mode', () => {
    mutableConfig.mode = 'path'
    mutableConfig.slug = 'operations'

    expect(getConsoleOverviewHref()).toBe('/operations')
  })

  it('uses the host root in host mode', () => {
    mutableConfig.mode = 'host'

    expect(getConsoleOverviewHref()).toBe('/')
  })
})

describe('getConsoleOrganizationsHref', () => {
  it('nests under the generated slug in path mode', () => {
    mutableConfig.mode = 'path'
    mutableConfig.slug = 'operations'

    expect(getConsoleOrganizationsHref()).toBe('/operations/organizations')
  })

  it('nests under the host root in host mode', () => {
    mutableConfig.mode = 'host'

    expect(getConsoleOrganizationsHref()).toBe('/organizations')
  })
})

describe('getConsoleUsersHref', () => {
  it('nests under the generated slug in path mode', () => {
    mutableConfig.mode = 'path'
    mutableConfig.slug = 'operations'

    expect(getConsoleUsersHref()).toBe('/operations/users')
  })

  it('nests under the host root in host mode', () => {
    mutableConfig.mode = 'host'

    expect(getConsoleUsersHref()).toBe('/users')
  })
})

describe('getConsoleAuditHref', () => {
  it('uses the generated slug in path mode and the root in host mode', () => {
    mutableConfig.mode = 'path'
    mutableConfig.slug = 'operations'
    expect(getConsoleAuditHref()).toBe('/operations/audit')
    mutableConfig.mode = 'host'
    expect(getConsoleAuditHref()).toBe('/audit')
  })
})
