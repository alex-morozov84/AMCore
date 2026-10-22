import assert from 'node:assert/strict'
import { resources, dispose } from './migrator-lifecycle/resources.mjs'
import { closeClient, safeError } from './migrator-lifecycle/safety.mjs'
import { fixture } from './migrator-application/fixture.mjs'
import { gates, compatibility } from './migrator-application/scenarios.mjs'
import { emit } from './migrator-operations/context.mjs'

const [migrator, previous, current, redis, ...extra] = process.argv.slice(2)
assert.ok(
  migrator && previous && current && redis && !extra.length,
  'Usage: node scripts/verify-migrator-application.mjs MIGRATOR PREVIOUS_API CURRENT_API REDIS'
)
let f
const failures = []
try {
  f = await resources()
  await fixture(f, migrator, previous, current, redis)
  await gates(f)
  await compatibility(f)
  emit(f, 'application-matrix', { architecture: f.artifact.Architecture, combinations: 4 })
} catch (error) {
  failures.push(error)
  console.error(JSON.stringify({ verdict: 'ERROR', run: f?.run, error: safeError(error) }))
} finally {
  for (const operation of [() => closeClient(f?.admin), () => f && dispose(f)]) {
    try {
      await operation()
    } catch (error) {
      failures.push(error)
    }
  }
  failures.push(...(f?.journalErrors ?? []))
}
if (failures.length) process.exitCode = 1
