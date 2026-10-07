import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ciLanes } from './e2e-ci-plan.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const lanes = ciLanes(root)
const requested = process.argv[2]

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
  // AMCORE_CONSOLE_CI_COMMAND_START
  if (lane === 'host') args.splice(5, 1, 'console-real-stack')
  // AMCORE_CONSOLE_CI_COMMAND_END
  let status = 0
  try {
    await run(process.execPath, args, {
      cwd: root,
      env: cleanEnvironment({ CI: 'true' }),
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
    } finally {
      await operation.finish()
    }
  }
  return status
}

if (requested === '--matrix') console.log(JSON.stringify({ lane: lanes }))
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
    results.push({ lane, seconds: (Date.now() - began) / 1000, status })
    console.log(JSON.stringify(results.at(-1)))
    if (status === 130 || status === 143) break
  }
  console.table(results)
  if (results.some((result) => result.status !== 0)) process.exitCode ||= 1
}
