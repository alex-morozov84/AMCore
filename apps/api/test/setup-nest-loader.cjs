// Jest evaluates CJS dependencies before ESM siblings in a mixed graph. A Nest
// companion can therefore require Nest while that graph is still loading.
// Finish the framework's synchronous ESM evaluation before loading each suite.
// This runs in each isolated test environment, independently of suite order.
require('@nestjs/common')
require('@nestjs/core')
require('@nestjs/bullmq')

// No frontend runs in the API fixture. Use distinct canonical test origins for host placement.
const { env } = require('node:process')
const placement = require('../../../packages/shared/src/config/product-admin.json')
if (placement.mode === 'host') {
  env.FRONTEND_URL ??= 'https://product.example.test'
  env.PRODUCT_ADMIN_ORIGIN ??= 'https://staff.example.test'
}
