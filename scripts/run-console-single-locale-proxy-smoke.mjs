import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commit, runInitProject } from './lib/init-project-test-helpers.mjs'
import { snapshot } from './stand/snapshot.mjs'
import { run } from './stand/process.mjs'
import { cancellation } from './stand/cancellation.mjs'

const workspace = await mkdtemp(join(tmpdir(), 'amcore-console-single-'))
const id = 'proxy-smoke'
const operation = await cancellation({ fixture: workspace, targetId: id })
try {
  await snapshot(process.cwd(), workspace)
  commit(workspace)
  const result = runInitProject(workspace, [
    '--mode=single',
    '--locale=en',
    '--admin-console=host',
    '--admin-console-slug=panel',
    '--yes',
  ])
  assert.equal(result.status, 0, result.stderr)
  await run('pnpm', ['install', '--frozen-lockfile'], { cwd: workspace, signal: operation.signal })
  await run(
    process.execPath,
    ['scripts/stand.mjs', 'e2e', '--lane', 'console-real-stack', '--id', id, '--proxy-smoke'],
    { cwd: workspace, signal: operation.signal }
  )
} catch (error) {
  if (!operation.interrupted) throw error
  console.error(`Wrapper cancelled: ${error.message}`)
} finally {
  await finishOperation()
  const manifest = await readFile(join(workspace, `.amcore/stands/${id}/manifest.json`), 'utf8')
    .then(JSON.parse)
    .catch(() => undefined)
  if (!manifest || manifest.state === 'purged')
    await rm(workspace, { recursive: true, force: true })
  else console.error(`Retained failed fixture and recovery record: ${workspace}`)
}

async function finishOperation() {
  try {
    await operation.finish()
  } catch (error) {
    console.error(`Cancellation incomplete; preserve fixture/recovery: ${workspace}`)
    throw error
  }
}
