import assert from 'node:assert/strict'
import { clearTimeout, setTimeout } from 'node:timers'
import { resources, dispose } from '../migrator-lifecycle/resources.mjs'
import { checkpoint, safeError, closeClient } from '../migrator-lifecycle/safety.mjs'
import { connect } from './connection.mjs'
import { fixture } from './fixture.mjs'
import { inventory, fresh, ledger, upgrade } from './history.mjs'
import { setupRoles } from './roles.mjs'
import { preflight, startupOptions, escapedOptions } from './options.mjs'
import { audit, audited } from './audit.mjs'
import { cli } from './cli.mjs'
import { imageUrl } from './connection.mjs'
import { partialRecovery, backupRestore } from './recovery.mjs'
import { emit } from './context.mjs'

export async function run(image, baseline, { runtimeFixes = false } = {}) {
  let f, admin, watchdog, pendingSignal
  const failures = []
  const stopped = (signal) => {
    pendingSignal = signal
    if (!f || f.interrupted) return
    f.interrupted = signal
    emit(f, 'interrupted', { verdict: 'ERROR', signal, journal: f.journalPath })
    watchdog = setTimeout(() => {
      console.error(JSON.stringify({ verdict: 'CLEANUP_REQUIRED', journal: f.journalPath }))
      process.exit(1)
    }, 60000)
  }
  const handlers = ['SIGTERM', 'SIGINT'].map((signal) => {
    const handler = () => stopped(signal)
    process.on(signal, handler)
    return [signal, handler]
  })
  try {
    f = await resources()
    f.phase = 'setup'
    emit(f, 'start', { journal: f.journalPath })
    if (pendingSignal) stopped(pendingSignal)
    checkpoint(f)
    await fixture(f, image)
    await inventory(f)
    await f.observer.query('CREATE DATABASE amcore')
    admin = await connect(f, 'amcore')
    const operations = new Map([
      ['roles', () => setupRoles(f, admin)],
      ['tls-preflight', () => preflight(f)],
      ['fresh-current-history', () => fresh(f, admin)],
      ['history-noop-status', () => history(f, admin, baseline)],
      ['startup-options', () => startupOptions(f, admin)],
      ['upgrade', () => upgrade(f)],
      ['partial-recovery', () => partialRecovery(f)],
      ['backup-restore', () => backupRestore(f, admin)],
      ['escaped-options', () => escapedOptions(f, admin)],
    ])
    const phases = runtimeFixes
      ? ['roles', 'fresh-current-history', 'escaped-options', 'upgrade', 'backup-restore']
      : [...operations.keys()].filter((phase) => phase !== 'escaped-options')
    for (const phase of phases) {
      checkpoint(f)
      f.phase = phase
      if (phase === 'escaped-options') await audit(f, admin)
      await operations.get(phase)()
    }
    checkpoint(f)
    emit(f, runtimeFixes ? 'operations-runtime-fixes' : 'operations-matrix', {
      architecture: f.artifact.Architecture,
      migrationCount: f.migrations.length,
      baselineCompared: Boolean(baseline) && !runtimeFixes,
      phases,
    })
  } catch (error) {
    failures.push(error)
    if (f) emit(f, f.phase, { verdict: 'ERROR', error: safeError(error), journal: f.journalPath })
    else console.error(JSON.stringify({ verdict: 'ERROR', error: safeError(error) }))
  } finally {
    for (const operation of [() => closeClient(admin), () => f && dispose(f)]) {
      try {
        await operation()
      } catch (error) {
        failures.push(error)
      }
    }
    failures.push(...(f?.journalErrors ?? []))
    clearTimeout(watchdog)
    for (const [signal, handler] of handlers) process.off(signal, handler)
  }
  if (failures.length || f?.interrupted) {
    console.error(
      JSON.stringify({ verdict: 'ERROR', error: safeError(new AggregateError(failures)) })
    )
    process.exitCode = 1
  }
}

async function history(f, admin, baseline) {
  await audit(f, admin)
  await audited(f, admin, 'noop-deploy', [])
  await audited(f, admin, 'status', ['migrate', 'status'])
  await ledger(f, admin, f.migrations)
  await cli(f, [], { url: imageUrl(f, 'amcore', 'amcore_runtime'), expected: 1 })
  if (baseline) {
    const [artifact] = JSON.parse(await f.docker(['image', 'inspect', baseline]))
    assert.equal(artifact.Architecture, f.artifact.Architecture)
    await audited(f, admin, 'previous-packaging-on-current-schema', ['migrate', 'status'], {
      artifact: artifact.Id,
    })
  }
}
