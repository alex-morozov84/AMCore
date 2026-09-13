import { afterEach, describe, expect, it } from 'vitest'

import { ADMIN_CONSOLE_CONFIG } from './admin-console.generated'
import { getConsolePublicApiPath } from './console-public-api-path'

const mutableConfig = ADMIN_CONSOLE_CONFIG as { mode: 'disabled' | 'path' | 'host' }
const originalMode = ADMIN_CONSOLE_CONFIG.mode

afterEach(() => {
  mutableConfig.mode = originalMode
})

describe('getConsolePublicApiPath', () => {
  it('uses the physical BFF prefix in path mode', () => {
    mutableConfig.mode = 'path'
    expect(getConsolePublicApiPath('/auth/login')).toBe('/console/auth/login')
  })

  it('uses the host proxy public path in host mode', () => {
    mutableConfig.mode = 'host'
    expect(getConsolePublicApiPath('/auth/login')).toBe('/auth/login')
  })
})
