import { run } from './migrator-operations/run.mjs'
const args = process.argv.slice(2)
const [image, baseline, ...extra] = args.filter((arg) => !arg.startsWith('--'))
if (!image || extra.length || args.some((arg) => arg.startsWith('--') && arg !== '--runtime-fixes'))
  throw new Error(
    'Usage: node scripts/verify-migrator-operations.mjs IMAGE [BASELINE_IMAGE] [--runtime-fixes]'
  )
await run(image, baseline, { runtimeFixes: args.includes('--runtime-fixes') })
