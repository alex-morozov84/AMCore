import { randomUUID } from 'node:crypto'
import { builtServices } from './config.mjs'
import { save } from './state.mjs'

// Write-ahead record of every `compose build` invocation. A build that is not proved
// terminal stays `pending`: a host-side exit code, process death or elapsed time says
// nothing about whether the Docker daemon is still exporting an image for this stand.
// Only a successful, unsignalled `compose build` return (exit 0) settles an entry here;
// everything else needs engine-side evidence (not implemented) or recorded risk
// acceptance. Entries are append-only and never replaced by a later build.
export const unresolvedBuilds = (m) => (m.builds ?? []).filter((b) => b.state === 'pending')

function unresolved(m, entries) {
  const error = new Error(
    `Build attempt ${entries.map((b) => b.invocation).join(', ')} has no proof that Docker ` +
      `finished exporting its images; stand record and source are kept and closeout is ` +
      `incomplete. Resolve it with: pnpm stand down --id ${m.id} --purge ` +
      `--accept-unresolved-build "<reason>" (or recover --id ${m.id} --purge for a retained ` +
      `lease). That records an explicit risk acceptance, not proof.`
  )
  error.code = 'BUILD_UNRESOLVED'
  return error
}

// `persist` is the manifest writer; tests inject a recorder.
export async function beginBuild(m, persist = save) {
  const entry = {
    invocation: randomUUID(),
    state: 'pending',
    services: [...builtServices],
    startedAt: new Date().toISOString(),
    sourceHash: m.sourceHash,
    engine: m.engine,
  }
  m.builds = [...(m.builds ?? []), entry]
  await persist(m)
  return entry
}

export async function settleBuild(m, entry, persist = save) {
  Object.assign(entry, {
    state: 'settled',
    outcome: 'succeeded',
    evidence: 'compose-build-exit-0',
    settledAt: new Date().toISOString(),
  })
  await persist(m)
}

// Persist intent, run the build, settle only if it returned. A rejection (non-zero exit,
// signal, spawn error) leaves the entry pending on purpose; nothing here classifies it.
export async function runBuild(m, build, persist = save) {
  assertBuildsResolved(m)
  const entry = await beginBuild(m, persist)
  await build()
  await settleBuild(m, entry, persist)
}

export async function acceptBuildRisk(m, reason, persist = save) {
  const pending = unresolvedBuilds(m)
  if (!pending.length) return
  if (typeof reason !== 'string' || reason.trim().length < 10)
    throw new Error('Accepting an unresolved build requires a written reason (10+ characters)')
  for (const entry of pending)
    Object.assign(entry, {
      state: 'accepted-risk',
      acceptance: { reason: reason.trim(), at: new Date().toISOString() },
    })
  await persist(m)
}

// Used both before starting another build (never overwrite an unresolved attempt) and
// before declaring a purge or closeout complete.
export function assertBuildsResolved(m) {
  const pending = unresolvedBuilds(m)
  if (pending.length) throw unresolved(m, pending)
}
