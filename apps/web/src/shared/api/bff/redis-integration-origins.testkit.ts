import { PRODUCT_ADMIN_CONFIG } from '@amcore/shared'

export const separateAdminHost = PRODUCT_ADMIN_CONFIG.mode === 'host'
export const redisFixtureSite = separateAdminHost
  ? 'https://product.example.test'
  : 'http://localhost:3002'
export const redisFixtureStaff = separateAdminHost ? 'https://staff.example.test' : ''
