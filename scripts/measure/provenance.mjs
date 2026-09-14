// Revision/environment provenance for scaffolding baseline measurements
// (BACKLOG item 14, PR1). A measurement is only safe to publish as part of a
// comparable baseline when the disposable repo copy every scenario runs
// against and the CLI code that actually executed came from the exact same,
// clean revision — see `classifyComparability`. Read-only: shells out to
// `git`/`node`/`pnpm` for version/identity info only, never mutates state.
import { execFileSync } from 'node:child_process'
import process from 'node:process'

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' }).trim()
}

/**
 * One snapshot of "what code is being measured right now" — captured once
 * per baseline run and reused for every scenario in that run, since every
 * scenario's disposable copy (`createRealRepoCopy()`, `git archive HEAD`)
 * and every scenario's executed CLI (the real, currently-checked-out
 * `scripts/init-project.mjs`/`init-brand.mjs`) derive from this same
 * process's working tree.
 */
export function collectRunProvenance() {
  const repoSha = run('git', ['rev-parse', 'HEAD'])
  const dirty = run('git', ['status', '--porcelain']).length > 0
  const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true'
  return {
    repoSha,
    repoDirty: dirty,
    // Both the fixture copy and the executed CLI are derived from this same
    // working tree at collection time — see the module doc comment. When
    // the tree is dirty there is no single sha that honestly describes
    // either one; `fixtureSha`/`cliSha` are still recorded as the nominal
    // HEAD for diagnostics, but `classifyComparability` below refuses to
    // call a dirty-tree run comparable regardless.
    fixtureSha: repoSha,
    cliSha: repoSha,
    nodeVersion: process.version,
    pnpmVersion: run('pnpm', ['--version']),
    environment: isCI ? 'github-actions' : 'local',
    runId: process.env.GITHUB_RUN_ID ?? null,
    collectedAt: new Date().toISOString(),
  }
}

/**
 * Whether `provenance` (from {@link collectRunProvenance}) is safe to treat
 * as one comparable baseline revision. Fails closed: any doubt about which
 * exact code produced a measurement makes that measurement non-comparable,
 * never silently included. Only a single, agreed revision may back a
 * published baseline (BACKLOG item 14's "Investigation and measurements").
 */
export function classifyComparability(provenance) {
  if (provenance.repoDirty) {
    return {
      comparable: false,
      reason:
        'working tree is dirty — HEAD does not fully describe the code that produced this measurement',
    }
  }
  if (provenance.fixtureSha !== provenance.repoSha || provenance.cliSha !== provenance.repoSha) {
    return {
      comparable: false,
      reason: 'fixture copy and executed CLI revisions do not both match repo HEAD',
    }
  }
  return { comparable: true, reason: null }
}

/** Stamps one scenario record with the shared run provenance plus its own name/start time. */
export function stampScenario(runProvenance, scenarioName) {
  return { scenarioName, startedAt: new Date().toISOString(), ...runProvenance }
}
