import { afterEach, describe, expect, it } from 'vitest'

import { ADMIN_CONSOLE_CONFIG } from './admin-console.generated'
import { getConsoleOrganizationsHref, getConsoleOverviewHref } from './console-public-href'

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
