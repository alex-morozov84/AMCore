import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { rm, readFile } from 'node:fs/promises'
import { directory, lease } from './state.mjs'
import { run, stopChildren, setJournal, children } from './process.mjs'

test('lease refuses competing mutation and stop waits for owned child exit before release', async () => {
  const id = `lease-proof-${randomUUID()}`
  const held = await lease(id, 'test')
  try {
    await assert.rejects(() => lease(id, 'competing-purge'), /busy/)
    setJournal(`${directory(id)}/lease/children.json`)
    const child = run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      cwd: directory(id),
      capture: true,
    })
    const verdict = assert.rejects(child, /SIGTERM/)
    const recorded = JSON.parse(await readFile(`${directory(id)}/lease/children.json`, 'utf8'))
    assert.equal(recorded.length, 1)
    assert.ok(recorded[0].pid)
    await stopChildren()
    await verdict
    assert.equal(children.size, 0)
    assert.deepEqual(JSON.parse(await readFile(`${directory(id)}/lease/children.json`, 'utf8')), [])
  } finally {
    setJournal(undefined)
    await held.release()
    await rm(directory(id), { recursive: true, force: true })
  }
})

test('direct verifier without managed lease refuses before Docker or test startup', async () => {
  await assert.rejects(
    () =>
      run(process.execPath, ['scripts/stand/active.mjs'], {
        cwd: new URL('../..', import.meta.url).pathname,
        capture: true,
        env: { PATH: process.env.PATH },
      }),
    /Use pnpm stand e2e/
  )
})
