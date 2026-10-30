import { productAdminE2ePlans } from './product-admin-e2e-plan.mjs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { auditPlan } from './lib/lighthouse-plan.mjs'
import { runIdentity } from './lighthouse/identity.mjs'
import { auditEnvironment } from './stand/lighthouse-phase.mjs'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ciLanes } from './e2e-ci-plan.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const lanes = ciLanes(root)
const requested = process.argv[2]
const auditIdentity = runIdentity(root)
const plan = auditPlan(root, auditIdentity)
const epoch = process.env.AMCORE_CI_EPOCH ? Number(process.env.AMCORE_CI_EPOCH) : Date.now()
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

async function browserLane(lane) {
  const { cancellation } = await import('./stand/cancellation.mjs')
  const { run, cleanEnvironment, stopChildren } = await import('./stand/process.mjs')
  const operation = await cancellation()
  const args = ['scripts/stand.mjs', 'e2e', '--id', operation.standId, '--lane', 'mocked']
  if (lane.startsWith('path-')) args.splice(5, 1, 'real-stack', '--ci-group', lane.slice(5))
  if (lane === 'setup-cli') args.splice(5, 1, 'real-stack', '--fixture', 'organization-setup')
  // AMCORE_CONSOLE_CI_COMMAND_START
  if (lane === 'host') args.splice(5, 1, 'console-real-stack')
  if (lane === 'setup-console')
    args.splice(5, 1, 'console-real-stack', '--fixture', 'organization-setup')
  // AMCORE_CONSOLE_CI_COMMAND_END
  const staffPlan = productAdminE2ePlans[lane]
  if (staffPlan)
    args.splice(5, 1, staffPlan.lane, '--fixture', staffPlan.fixture, '--', ...staffPlan.files)
  let status = 0
  let termination = 'passed'
  try {
    await run(process.execPath, args, {
      cwd: root,
      env: cleanEnvironment({
        CI: 'true',
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
      if (lane === 'mocked') await closeMockedRunner(operation.standId)
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
      cleanup: lane === 'mocked' || m?.state === 'purged' ? 'passed' : 'failed',
    }),
    { mode: 0o600 }
  )
  return status
}

if (requested === '--matrix')
  console.log(
    JSON.stringify({
      include: lanes.map((lane) => ({ lane, timeout: plan.assignments[lane].length ? 40 : 20 })),
    })
  )
else if (requested === '--audit-plan') console.log(JSON.stringify(plan))
else {
  if (requested !== '--all' && !lanes.includes(requested)) throw new Error('Unknown E2E CI lane')
  const results = []
  for (const lane of requested === '--all' ? lanes : [requested]) {
    const began = Date.now()
    const status =
      lane === 'safety'
        ? spawnSync('pnpm', ['test:stands'], {
            cwd: root,
            env: { ...process.env, CI: 'true' },
            stdio: 'inherit',
          }).status
        : await browserLane(lane)
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
  if (results.some((result) => result.status !== 0)) process.exitCode ||= 1
}
