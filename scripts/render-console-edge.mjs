import { fileURLToPath } from 'node:url'

import { consoleEdgeFiles } from './lib/console-edge.mjs'

if (process.argv.length !== 3 || !['--write', '--check'].includes(process.argv[2]))
  throw new Error('Usage: node scripts/render-console-edge.mjs --write|--check')
consoleEdgeFiles(fileURLToPath(new URL('../', import.meta.url)), process.argv[2] === '--write')
