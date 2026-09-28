import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { root } from './state.mjs'
import { engine } from './docker.mjs'
import { run } from './process.mjs'

test('standalone dev recipe retains root project and Redis volume identity after relocation', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'amcore-dev-model-'))
  const file = join(fixture, 'legacy.yml')
  const checkout = join(fixture, 'checkout')
  await mkdir(checkout)
  const current = await readFile(`${root}/docker/compose/dev.yml`, 'utf8')
  // Render the same standalone model from a root-level location and its moved
  // location; this proof needs no upstream Git history in a contributor fork.
  await writeFile(file, current)
  const { context } = await engine()
  const model = async (path, explicitRoot = true) =>
    JSON.parse(
      await run(
        'docker',
        [
          '--context',
          context,
          'compose',
          ...(explicitRoot ? ['--project-directory', checkout] : []),
          '--env-file',
          '/dev/null',
          '-f',
          path,
          'config',
          '--format',
          'json',
        ],
        { capture: true }
      )
    )
  try {
    assert.match(
      current,
      /Usage .*docker compose --project-directory \. -f docker\/compose\/dev.yml up -d/
    )
    const before = await model(file)
    const after = await model(`${root}/docker/compose/dev.yml`)
    assert.deepEqual(after, before)
    const incorrect = await model(`${root}/docker/compose/dev.yml`, false)
    assert.notEqual(incorrect.name, after.name)
    assert.notEqual(incorrect.volumes.redis_dev_data.name, after.volumes.redis_dev_data.name)
  } finally {
    await rm(fixture, { recursive: true })
  }
})
