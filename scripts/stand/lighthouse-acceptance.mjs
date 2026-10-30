import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { invariant } from '../lib/lighthouse-plan.mjs'
import { admitCase } from '../lib/lighthouse-deadlines.mjs'
import { run, cleanEnvironment, stopChildren, children } from './process.mjs'
import { directory } from './state.mjs'

export async function auditAcceptance(m, token, deadline) {
  invariant(process.env.CI !== 'true', 'acceptance-controls-require-local-authority')
  const fixtureDir = join(directory(m.id), 'tmp/lighthouse-members')
  const proof = []
  for (const mode of [
    'wrong-user',
    'failed-login-canary',
    'expired',
    'sign-in-stall',
    'audit-stall',
  ]) {
    const end = admitCase(deadline)
    const signal = globalThis.AbortSignal.timeout(end - Date.now())
    const output = join(directory(m.id), `tmp/acceptance-${mode}`)
    await mkdir(output, { mode: 0o700 })
    let failed = false
    try {
      await run(
        process.execPath,
        [
          '--import',
          join(m.snapshot, 'apps/api/node_modules/tsx/dist/loader.mjs'),
          join(m.snapshot, 'scripts/lighthouse/case-worker.mjs'),
          'members',
          output,
          join(output, 'result.json'),
          mode,
          fixtureDir,
        ],
        {
          cwd: m.snapshot,
          signal,
          capture: true,
          env: cleanEnvironment({
            AMCORE_STAND_MANIFEST: join(directory(m.id), 'manifest.json'),
            AMCORE_STAND_TOKEN: token,
          }),
        }
      )
    } catch {
      failed = true
    }
    await stopChildren()
    invariant(children.size === 0, 'acceptance-owned-survivor')
    if (mode.endsWith('stall')) {
      const entered = JSON.parse(await readFile(join(fixtureDir, `entered-${mode}.json`), 'utf8'))
      invariant(
        failed &&
          signal.aborted &&
          Date.now() - end <= 30_000 &&
          ['sign-in', 'audit'].includes(entered.stage),
        'forced-cancellation-not-proved'
      )
      proof.push({
        mode,
        passed: true,
        forced: true,
        terminationMs: Date.now() - end,
        survivors: 0,
      })
    } else if (mode === 'expired') {
      const entered = JSON.parse(await readFile(join(fixtureDir, 'entered-expired.json'), 'utf8'))
      invariant(
        failed && !signal.aborted && entered.stage === 'audit',
        'mid-audit-expiry-not-refused'
      )
      proof.push({ mode, passed: true, survivors: 0 })
    } else {
      const result = JSON.parse(await readFile(join(output, 'result.json'), 'utf8'))
      invariant(!failed && result.acceptedRefusal === true, 'negative-control-not-refused')
      proof.push({ mode, passed: true, survivors: 0 })
    }
    await rm(output, { recursive: true, force: true })
  }
  return proof
}
