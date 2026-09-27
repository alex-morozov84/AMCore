import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, rm, access } from 'node:fs/promises'
import { root, directory, load } from './state.mjs'
import { run } from './process.mjs'
import { recover } from './recovery.mjs'

test('hard crash keeps its lease; concurrent explicit recovery has one writer and never queries Docker for mocks', async () => {
  const id = `crash-${randomUUID()}`
  const dir = directory(id)
  const attempt = randomUUID()
  const program = `
    const { lease, save } = await import(${JSON.stringify(`${root}/scripts/stand/state.mjs`)});
    await lease(${JSON.stringify(id)}, 'crash-proof');
    await save({ version: 1, id: ${JSON.stringify(id)}, uuid: ${JSON.stringify(randomUUID())},
      attempt: ${JSON.stringify(attempt)}, worktree: ${JSON.stringify(root)}, mocked: true,
      purpose: 'e2e', topology: 'path', snapshot: ${JSON.stringify(`${dir}/source-${attempt}`)}, state: 'allocated' });
    setInterval(() => {}, 1000);
  `
  const running = run(process.execPath, ['--input-type=module', '-e', program], { capture: true })
  const ended = assert.rejects(running, /SIGKILL/)
  let pid
  try {
    for (let n = 0; n < 100; n++) {
      const owner = await readFile(`${dir}/lease/owner.json`, 'utf8')
        .then(JSON.parse)
        .catch(() => undefined)
      const manifest = await load(id).catch(() => undefined)
      if (owner && manifest) {
        pid = owner.pid
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.ok(pid, 'controller did not initialize')
    process.kill(pid, 'SIGKILL')
    await ended
    await access(`${dir}/lease/owner.json`)
    const verdicts = await Promise.allSettled([recover(id, true), recover(id, true)])
    assert.equal(
      verdicts.filter((v) => v.status === 'fulfilled').length,
      1,
      verdicts.map((v) => v.reason?.message).join(' | ')
    )
    assert.equal((await load(id)).state, 'purged')
    await assert.rejects(() => access(`${dir}/lease`), { code: 'ENOENT' })
    await assert.rejects(() => access(`${dir}/recovery`), { code: 'ENOENT' })
  } finally {
    if (pid) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        /* Already exited. */
      }
    }
    await rm(dir, { recursive: true, force: true })
  }
})
