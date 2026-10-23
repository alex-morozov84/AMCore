import { clearTimeout, setTimeout } from 'node:timers'
import { fixture } from './migrator-lifecycle/fixture.mjs'
import { resources, dispose } from './migrator-lifecycle/resources.mjs'
import { runCase } from './migrator-lifecycle/case.mjs'
import { checkpoint, report, safeError } from './migrator-lifecycle/safety.mjs'

const [image] = process.argv.slice(2)
if (!image) throw new Error('Usage: node scripts/verify-migrator-lifecycle.mjs IMAGE')
let f, failure, watchdog, pendingSignal
const interrupted = (signal) => {
  if (f?.interrupted) return
  pendingSignal = signal
  if (!f) return
  f.interrupted = signal
  report(f, 'ERROR', { phase: 'interrupted', error: { code: signal }, journal: f.journalPath })
  // A stuck acquisition cannot be trusted as cleaned. The durable journal and
  // independent CI cleanup remain available even after this forced exit.
  watchdog = setTimeout(() => {
    console.error(JSON.stringify({ verdict: 'CLEANUP_REQUIRED', journal: f.journalPath }))
    process.exit(1)
  }, 60000)
}
const handlers = ['SIGTERM', 'SIGINT'].map((signal) => {
  const handler = () => interrupted(signal)
  process.on(signal, handler)
  return [signal, handler]
})
try {
  f = await resources()
  report(f, 'START', { journal: f.journalPath })
  if (pendingSignal) interrupted(pendingSignal)
  checkpoint(f)
  await fixture(f, image)
  for (const transactional of [false, true]) {
    for (const signal of ['TERM', 'INT']) {
      checkpoint(f)
      await runCase(f, transactional, signal)
    }
  }
} catch (error) {
  failure = error
  if (f) report(f, 'ERROR', { phase: 'run', error: safeError(error), journal: f.journalPath })
  else
    console.error(
      JSON.stringify({ verdict: 'ERROR', phase: 'initialize', error: safeError(error) })
    )
} finally {
  if (f) {
    try {
      await dispose(f)
    } catch (error) {
      failure = new AggregateError([...(failure ? [failure] : []), error], 'Run/cleanup failed')
    }
    if (f.journalErrors?.length) {
      failure = new AggregateError(
        [...(failure ? [failure] : []), ...f.journalErrors],
        'Journal failed'
      )
    }
  }
  clearTimeout(watchdog)
  for (const [signal, handler] of handlers) process.off(signal, handler)
}
if (failure || f?.interrupted) {
  console.error(JSON.stringify({ verdict: 'ERROR', phase: 'final', error: safeError(failure) }))
  process.exitCode = 1
}
