import { run } from './migrator-operations/run.mjs'
const [image, baseline] = process.argv.slice(2)
if (!image)
  throw new Error('Usage: node scripts/verify-migrator-operations.mjs IMAGE [BASELINE_IMAGE]')
await run(image, baseline)
