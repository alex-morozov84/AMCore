import { existsSync } from 'node:fs'
import { dispose, recovery } from './migrator-lifecycle/resources.mjs'
import { safeError } from './migrator-lifecycle/safety.mjs'

const [journal] = process.argv.slice(2)
if (!journal) throw new Error('Usage: node scripts/cleanup-migrator-lifecycle.mjs ABSOLUTE_JOURNAL')
if (existsSync(journal)) {
  try {
    const f = recovery(journal)
    // The original process may have died without printing a failure.
    console.error(JSON.stringify({ verdict: 'INTERRUPTED_RUN_CLEANUP', run: f.run, journal }))
    await dispose(f)
  } catch (error) {
    console.error(JSON.stringify({ verdict: 'CLEANUP_ERROR', journal, error: safeError(error) }))
    process.exitCode = 1
  }
}
