import { admitAuditAfterTests } from '../lib/lighthouse-admission.mjs'
import { packReports } from '../lib/lighthouse-archive.mjs'
import { auditAcceptance } from './lighthouse-acceptance.mjs'
import { mkdir, readFile, copyFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { auditPlan, digest, invariant } from '../lib/lighthouse-plan.mjs'
import { collectCoverage } from '../lib/lighthouse-coverage.mjs'
import { phaseDeadline, admitCase } from '../lib/lighthouse-deadlines.mjs'
import { writeManifest, verifyBundle } from '../lib/lighthouse-reports.mjs'
import { run, cleanEnvironment, stopChildren, setProcessDeadline } from './process.mjs'
import { directory, save } from './state.mjs'
import { docker, inspect } from './docker.mjs'
import { invocationTarget } from './invocation.mjs'

const invoked = new WeakSet()
export function auditEnvironment(plan, lane, epoch, output) {
  return {
    AMCORE_AUDIT_PLAN: JSON.stringify(plan),
    AMCORE_AUDIT_OWNER: lane,
    AMCORE_AUDIT_EPOCH: String(epoch),
    AMCORE_AUDIT_OUTPUT: output,
  }
}
export async function runAuditPhase(m, token) {
  invariant(!invoked.has(m), 'duplicate-audit-phase')
  invoked.add(m)
  const expected = JSON.parse(process.env.AMCORE_AUDIT_PLAN)
  const lane = process.env.AMCORE_AUDIT_OWNER
  const plan = auditPlan(m.worktree, {
    run: expected.run,
    attempt: expected.attempt,
    source: expected.source,
  })
  invariant(
    plan.digest === expected.digest && plan.assignments[lane]?.length,
    'unassigned-audit-phase'
  )
  const output = join(
    m.worktree,
    '.amcore/lighthouse-results',
    plan.run,
    plan.attempt,
    lane,
    'bundle'
  )
  invariant(process.env.AMCORE_AUDIT_OUTPUT === output, 'foreign-audit-output')
  await mkdir(join(output, '..'), { recursive: true, mode: 0o700 })
  await mkdir(join(output, '../invocation'), { recursive: false, mode: 0o700 })
  const deadline = phaseDeadline(Number(process.env.AMCORE_AUDIT_EPOCH))
  setProcessDeadline(deadline)
  m.auditStarted = Date.now()
  await save(m)
  await invocationTarget(m)
  admitAuditAfterTests(m, process.env.CI)
  const built = await builtInputs(m)
  const coverage = collectCoverage(m.snapshot, built)
  const results = [],
    files = []
  await mkdir(output, { recursive: true, mode: 0o700 })
  for (const id of plan.assignments[lane]) {
    const caseDir = join(directory(m.id), 'tmp', `lighthouse-${id}`)
    await mkdir(caseDir, { recursive: false, mode: 0o700 })
    try {
      const stop = admitCase(deadline)
      await run(
        process.execPath,
        [
          '--import',
          join(m.snapshot, 'apps/api/node_modules/tsx/dist/loader.mjs'),
          join(m.snapshot, 'scripts/lighthouse/case-worker.mjs'),
          id,
          caseDir,
          join(caseDir, 'result.json'),
        ],
        {
          cwd: m.snapshot,
          env: cleanEnvironment({
            AMCORE_STAND_MANIFEST: join(directory(m.id), 'manifest.json'),
            AMCORE_STAND_TOKEN: token,
            ...(process.env.AMCORE_AUDIT_ACCEPTANCE === 'true'
              ? { AMCORE_AUDIT_ACCEPTANCE: 'true' }
              : {}),
          }),
          signal: globalThis.AbortSignal.timeout(stop - Date.now()),
          capture: true,
        }
      )
      const result = JSON.parse(await readFile(join(caseDir, 'result.json'), 'utf8'))
      invariant(result.id === id && result.files?.length === 2, 'invalid-case-result')
      for (const file of result.files) {
        invariant(file.name === `${id}.html` || file.name === `${id}.json`, 'unexpected-case-file')
        invariant(
          digest(await readFile(join(caseDir, file.name))) === file.sha256,
          'case-hash-mismatch'
        )
        await copyFile(join(caseDir, file.name), join(output, file.name))
        files.push(file)
      }
      delete result.files
      results.push(result)
    } catch {
      const failure = await readFile(join(caseDir, 'result.json'), 'utf8')
        .then(JSON.parse)
        .catch(() => undefined)
      const safe =
        failure?.id === id && failure?.valid === false
          ? {
              id,
              valid: false,
              stage: failure.stage,
              reason: failure.reason,
              navigationProof: failure.navigationProof,
            }
          : { id, valid: false, reason: 'case-refused-or-timed-out' }
      console.error(JSON.stringify(safe))
      results.push(safe)
    } finally {
      await stopChildren()
    }
  }
  invariant(Date.now() <= deadline, 'audit-phase-deadline-exhausted')
  const acceptance =
    process.env.AMCORE_AUDIT_ACCEPTANCE === 'true' &&
    results.some((r) => r.id === 'members' && r.valid)
      ? await auditAcceptance(m, token, deadline)
      : []
  for (const id of plan.assignments[lane])
    await rm(join(directory(m.id), 'tmp', `lighthouse-${id}`), { recursive: true, force: true })
  const manifest = {
    acceptance,
    priorTests: m.testOutcome,
    localAudit: m.auditOnly === true,
    version: 1,
    plan: plan.digest,
    run: plan.run,
    attempt: plan.attempt,
    source: plan.source,
    lane,
    config: plan.config,
    descriptors: plan.descriptors,
    content: m.buildSourceHash ?? m.sourceHash,
    tooling: m.auditToolsHash,
    compiled: m.compiledFingerprint,
    lock: digest(await readFile(join(m.snapshot, 'pnpm-lock.yaml'))),
    build: coverage.build,
    images: m.images,
    coverage,
    results,
    files,
  }
  const manifestHash = await writeManifest(output, manifest)
  await verifyBundle(output, { plan: plan.digest, lane })
  const archiveHash = await packReports(output, join(output, '../payload.json.gz'))
  m.audit = {
    archiveHash,
    lane,
    output,
    manifestHash,
    observed: results.map((r) => r.id),
    passed: results.every((r) => r.valid && r.policy.passed),
  }
  await save(m)
  invariant(m.audit.passed, 'audit-policy-or-measurement-failure')
}

async function builtInputs(m) {
  const target = await invocationTarget(m)
  for (const id of target.resources.container) {
    const container = await inspect(target, 'container', id)
    if (container.Config.Labels['com.docker.compose.service'] !== 'web') continue
    invariant(container.Image === target.images.web, 'runtime-build-image-mismatch')
    const script = `const fs=require('node:fs');console.log(JSON.stringify({pages:JSON.parse(fs.readFileSync('apps/web/.next/app-path-routes-manifest.json')),build:fs.readFileSync('apps/web/.next/BUILD_ID','utf8').trim(),next:require('./apps/web/node_modules/next/package.json').version}))`
    return JSON.parse(await docker(target, ['exec', id, 'node', '-e', script], { capture: true }))
  }
  throw new Error('missing-admitted-web-container')
}
