import { networkAndCleanup } from './migrator-controls/network.mjs'
import { stopHarness } from './migrator-controls/interrupt.mjs'
import { negative } from './migrator-controls/negative.mjs'
import { advisory } from './migrator-controls/advisory.mjs'
import { safeError } from './migrator-lifecycle/safety.mjs'
const [image, mode] = process.argv.slice(2)
if (!image || !['network', 'interrupt', 'negative', 'advisory'].includes(mode))
  throw new Error(
    'Usage: node scripts/verify-migrator-controls.mjs IMAGE network|interrupt|negative|advisory'
  )
try {
  if (mode === 'network') await networkAndCleanup(image)
  if (mode === 'interrupt')
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGKILL']) await stopHarness(image, signal)
  if (mode === 'negative')
    for (const variant of ['no-tini', 'no-guc']) await negative(image, variant)
  if (mode === 'advisory') await advisory(image)
} catch (error) {
  console.error(JSON.stringify({ verdict: 'ERROR', error: safeError(error) }))
  process.exitCode = 1
}
