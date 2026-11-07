import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { invariant } from '../lib/lighthouse-plan.mjs'
import { admitCase } from '../lib/lighthouse-deadlines.mjs'
import { run, cleanEnvironment, stopChildren, children } from './process.mjs'
import { directory } from './state.mjs'

export function acceptanceTarget(assigned, results, consoleTopology) {
  if (!assigned.every((id) => results.some((r) => r.id === id && r.valid && r.policy?.passed)))
    return { reason: 'required-positive-failed' }
  if (assigned.includes('members')) return { scenario: 'members' }
  if (assigned.includes('console-overview') && consoleTopology === 'host')
    return { scenario: 'console-overview' }
  return { reason: 'acceptance-target-unavailable' }
}

export function documentRefusal(result, scenario, failed, aborted) {
  if (
    !failed ||
    aborted ||
    scenario !== 'members' ||
    result?.id !== scenario ||
    result.valid !== false
  )
    return false
  if (!Array.isArray(result.navigationProof)) return false
  if (
    result.navigationProof.some(
      (p) => p.passed === false && p.code === 'measured-session-fence-missing'
    )
  )
    return true
  const probe = result.probes?.at(-1)
  return (
    result.stage === 'page-identity' &&
    result.reason === 'measured-session-fence-missing' &&
    result.navigationProof.length === 0 &&
    probe?.path === '/api/auth/me' &&
    probe.passed === true &&
    probe.status === 200
  )
}

export async function auditAcceptance(m, token, deadline, scenario = 'members') {
  invariant(process.env.CI !== 'true', 'acceptance-controls-require-local-authority')
  invariant(
    scenario === 'members' || (scenario === 'console-overview' && m.consoleTopology === 'host'),
    'incompatible-acceptance-target'
  )
  const fixtureDir = join(directory(m.id), `tmp/lighthouse-${scenario}`)
  const fixture = JSON.parse(await readFile(join(fixtureDir, 'fixture.json'), 'utf8'))
  invariant(
    Boolean(fixture.subject) &&
      (scenario === 'members' ? !fixture.consoleHost : fixture.consoleHost),
    'incompatible-acceptance-target'
  )
  const proof = []
  const modes =
    scenario === 'members'
      ? [
          'wrong-user',
          'failed-login-canary',
          'expired',
          'sign-in-stall',
          'audit-stall',
          'split-document',
          'page-401',
          // Retirement must run last: it invalidates the saved server session.
          'retired-session',
        ]
      : ['product-on-console-host']
  for (const mode of modes) {
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
          scenario,
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
    } else if (['split-document', 'retired-session'].includes(mode)) {
      const result = JSON.parse(await readFile(join(output, 'result.json'), 'utf8'))
      invariant(
        documentRefusal(result, scenario, failed, signal.aborted),
        'wrong-document-not-refused'
      )
      proof.push({
        mode,
        passed: true,
        survivors: 0,
        stage: result.stage,
        reason: result.reason,
        probes: result.probes,
        navigationProof: result.navigationProof,
      })
    } else {
      const result = JSON.parse(await readFile(join(output, 'result.json'), 'utf8'))
      invariant(!failed && result.acceptedRefusal === true, 'negative-control-not-refused')
      proof.push({ mode, passed: true, survivors: 0 })
    }
    await writeFile(
      join(directory(m.id), `acceptance-${mode}.json`),
      JSON.stringify(proof.at(-1)),
      { mode: 0o600 }
    )
    await rm(output, { recursive: true, force: true })
  }
  return proof
}
