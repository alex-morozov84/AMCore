import { sourceSettings } from './stand/settings-policy.mjs'
import { isDeepStrictEqual } from 'node:util'
import {
  configuredBrowserCases,
  configuredConsoleFixtureDigest,
  requireConfiguredBaseCases,
} from './lib/configured-browser-cases.mjs'
import { laneJobMinutes } from './lib/lighthouse-deadlines.mjs'
import { publishPlan } from './lighthouse/ci-plan.mjs'
import { fixedBrowserProfile } from './lib/fixed-browser-profiles.mjs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { auditPlan, auditScope } from './lib/lighthouse-plan.mjs'
import { runIdentity } from './lighthouse/identity.mjs'
import { auditEnvironment, laneEpoch } from './lib/lighthouse-command.mjs'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ciLanes, configuredArguments, consoleFixture, consoleFixtureLane } from './e2e-ci-plan.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const requested = process.argv[2]
const upstream = process.env.AMCORE_CI_ROLE === 'upstream-starter'
const nativeEvidence = process.env.AMCORE_E2E_INVENTORY === 'configured'
const configured =
  nativeEvidence || requested === '--configured-matrix' || requested?.startsWith('configured-')
const lanes = ciLanes(root, { configured, upstream })
const matrix = ['--matrix', '--configured-matrix'].includes(requested)
const identity = matrix ? undefined : runIdentity(root)
async function plannedCases() {
  const selection = JSON.parse(process.env.CI_PLAN)
  if (
    selection.source.checkout !== identity.source ||
    selection.run !== identity.run ||
    selection.attempt !== identity.attempt
  )
    throw new Error('Browser collection belongs to a different CI attempt')
  const collection = JSON.parse(await readFile(process.env.AMCORE_CONFIGURED_COLLECTION, 'utf8'))
  if (!isDeepStrictEqual(collection.settings, await sourceSettings(root)))
    throw new Error('Browser collection differs from checkout settings')
  const cases = configuredBrowserCases(root, identity, collection)
  const fixture =
    selection.event !== 'push' && selection.proposed?.web === 'runtime'
      ? consoleFixture(root)
      : undefined
  if (selection.event === 'pull_request') {
    const base = JSON.parse(await readFile(process.env.AMCORE_CONFIGURED_BASE_COLLECTION, 'utf8'))
    requireConfiguredBaseCases(
      { ...identity, source: selection.source.base },
      base,
      collection,
      fixture,
      upstream
    )
  }
  if (fixture) {
    const fixtureDigest = configuredConsoleFixtureDigest(root, collection)
    if (fixtureDigest) cases[consoleFixtureLane] = fixtureDigest
  }
  return cases
}
const configuredCases =
  nativeEvidence && requested === '--plan-ci' ? await plannedCases() : undefined
const plan = matrix
  ? auditScope(root, { configured, upstream })
  : auditPlan(root, identity, {
      configured,
      upstream,
      configuredCases,
    })
if (
  process.env.AMCORE_EXPECTED_AUDIT_PLAN &&
  JSON.parse(process.env.AMCORE_EXPECTED_AUDIT_PLAN).digest !== plan.digest
)
  throw new Error('Unexpected Web E2E plan')
if (nativeEvidence && !matrix && !plan.configuredCases)
  throw new Error('Missing configured browser evidence plan')
const auditDirectory = (lane) =>
  join(root, '.amcore/lighthouse-results', plan.run, plan.attempt, lane)

async function closeMockedRunner(standId) {
  const { load, lease } = await import('./stand/state.mjs')
  const { waitForRunnerCloseout } = await import('./stand/wait-closeout.mjs')
  const held = await lease(standId, 'ci-closeout')
  try {
    await waitForRunnerCloseout(await load(standId))
  } finally {
    await held.release()
  }
}

async function browserLane(lane, epoch) {
  const { cancellation } = await import('./stand/cancellation.mjs')
  const { run, cleanEnvironment, stopChildren } = await import('./stand/process.mjs')
  const operation = await cancellation()
  const args = ['scripts/stand.mjs', 'e2e', '--id', operation.standId, '--lane', 'mocked']
  if (lane.startsWith('path-')) args.splice(5, 1, 'real-stack', '--ci-group', lane.slice(5))
  if (lane.startsWith('configured-'))
    args.splice(4, args.length - 4, ...configuredArguments(root, lane))
  const fixture = lane === consoleFixtureLane ? consoleFixture(root) : undefined
  if (fixture) args.splice(5, 1, fixture.project, '--fixture', fixture.name, '--', ...fixture.args)
  const fixed = fixedBrowserProfile(lane)
  if (fixed) {
    args.splice(5, 1, fixed.lane, ...(fixed.fixture ? ['--fixture', fixed.fixture] : []))
    if (fixed.files) args.push('--', ...fixed.files)
  }
  const mocked = args[5] === 'mocked'
  let status = 0
  let termination = 'passed'
  try {
    await run(process.execPath, args, {
      cwd: root,
      env: cleanEnvironment({
        CI: 'true',
        ...(lane === 'configured-mocked' && process.env.AMCORE_MOCK_TLS_DIR
          ? { AMCORE_MOCK_TLS_DIR: process.env.AMCORE_MOCK_TLS_DIR }
          : {}),
        ...(plan.browserCases?.[lane]
          ? {
              AMCORE_BROWSER_EVIDENCE: JSON.stringify({
                source: plan.source,
                run: plan.run,
                attempt: plan.attempt,
                lane,
                plan: plan.digest,
                expected: plan.browserCases[lane],
                ...(nativeEvidence ? { configured: true } : {}),
              }),
            }
          : {}),
        ...(process.env.GITHUB_ACTIONS === 'true' ? { AMCORE_E2E_EPOCH: String(epoch) } : {}),
        ...(plan.assignments[lane].length
          ? auditEnvironment(plan, lane, epoch, join(auditDirectory(lane), 'bundle'))
          : {}),
      }),
      signal: operation.signal,
      graceful: true,
    })
  } catch (error) {
    console.error(error.message)
    status = operation.interrupted ? process.exitCode : 1
  } finally {
    try {
      await stopChildren()
      if (mocked) await closeMockedRunner(operation.standId)
    } catch {
      termination = 'failed'
      status ||= 1
    } finally {
      try {
        await operation.finish()
      } catch {
        termination = 'failed'
        status ||= 1
      }
    }
  }
  const m = await readFile(join(root, '.amcore/stands', operation.standId, 'manifest.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => undefined)
  await mkdir(auditDirectory(lane), { recursive: true, mode: 0o700 })
  await writeFile(
    join(auditDirectory(lane), 'lifecycle.json'),
    JSON.stringify({
      setup: m?.testOutcome ? 'passed' : 'failed',
      test: m?.testOutcome ?? 'failed',
      termination,
      browserEvidence: m?.browserEvidence,
      cleanup: mocked || m?.state === 'purged' ? 'passed' : 'failed',
    }),
    { mode: 0o600 }
  )
  return status
}

if (matrix)
  console.log(
    JSON.stringify({
      include: lanes.map((lane) => ({
        lane,
        timeout: laneJobMinutes(plan.assignments[lane].length > 0),
      })),
    })
  )
else if (requested === '--audit-plan') console.log(JSON.stringify(plan))
else if (requested === '--plan-ci') publishPlan(plan)
else {
  const plannedLanes = Object.keys(plan.assignments)
  if (requested !== '--all' && !plannedLanes.includes(requested))
    throw new Error('Unknown E2E CI lane')
  const results = []
  for (const lane of requested === '--all' ? plannedLanes : [requested]) {
    const began = Date.now()
    const epoch = laneEpoch(process.env.AMCORE_CI_EPOCH, began)
    const status =
      lane === 'safety'
        ? spawnSync('pnpm', ['test:stands'], {
            cwd: root,
            env: { ...process.env, CI: 'true' },
            stdio: 'inherit',
          }).status
        : await browserLane(lane, epoch)
    if (lane === 'safety') {
      await mkdir(auditDirectory(lane), { recursive: true, mode: 0o700 })
      await writeFile(
        join(auditDirectory(lane), 'lifecycle.json'),
        JSON.stringify({
          setup: status === 0 ? 'passed' : 'failed',
          test: status === 0 ? 'passed' : 'failed',
          termination: status === 0 ? 'passed' : 'failed',
          cleanup: status === 0 ? 'passed' : 'failed',
        }),
        { mode: 0o600 }
      )
    }
    results.push({ lane, seconds: (Date.now() - began) / 1000, status })
    console.log(JSON.stringify(results.at(-1)))
    if (status === 130 || status === 143) break
  }
  console.table(results)
  if (requested === '--all' && !process.env.GITHUB_ACTIONS) {
    const { writeLocalRunIndex } = await import('./lighthouse/local-run-view.mjs')
    console.log(`Open Lighthouse reports: ${await writeLocalRunIndex(plan, root)}`)
  }
  if (results.some((result) => result.status !== 0)) process.exitCode ||= 1
}
