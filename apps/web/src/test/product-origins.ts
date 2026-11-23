import { PRODUCT_ADMIN_CONFIG } from '@amcore/shared'
import { vi } from 'vitest'

export function stubProductOrigins(site: string) {
  vi.stubEnv('FRONTEND_URL', site)
  vi.stubEnv(
    'PRODUCT_ADMIN_ORIGIN',
    PRODUCT_ADMIN_CONFIG.mode === 'host' ? 'https://staff.example.test' : site
  )
}
