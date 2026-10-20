import { fileURLToPath } from 'node:url'

import { productAdminEdgeFiles } from './lib/product-admin-edge.mjs'

if (process.argv.length !== 3 || !['--write', '--check'].includes(process.argv[2]))
  throw new Error('Usage: node scripts/render-product-admin-edge.mjs --write|--check')
productAdminEdgeFiles(fileURLToPath(new URL('../', import.meta.url)), process.argv[2] === '--write')
