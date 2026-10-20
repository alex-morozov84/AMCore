import { fileURLToPath } from 'node:url'

import { inspectProductAdminPlacement } from './lib/product-admin-placement.mjs'
import { productAdminEdgeFiles } from './lib/product-admin-edge.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const args = process.argv.slice(2)
if (args.length > 1 || (args[0] && !args[0].startsWith('--alias=')))
  throw new Error('Usage: node scripts/check-product-admin-placement.mjs [--alias=<candidate>]')
const result = inspectProductAdminPlacement(root, args[0]?.slice('--alias='.length))
productAdminEdgeFiles(root)
console.log(
  `Product-admin placement valid: ${result.mode}/${result.alias}, ${result.routes.length} physical endpoints`
)
