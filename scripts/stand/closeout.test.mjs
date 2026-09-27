import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, cp, mkdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { root } from './state.mjs'
import { run } from './process.mjs'

test('whole-checkout closeout retains recovery after a live child, then verifies every record', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'amcore-closeout-proof-'))
  await mkdir(`${fixture}/scripts`)
  await symlink(`${root}/node_modules`, `${fixture}/node_modules`)
  await cp(`${root}/scripts/stand`, `${fixture}/scripts/stand`, {
    recursive: true,
    filter: (path) => !path.endsWith('.test.mjs'),
  })
  const program = `
    import assert from 'node:assert/strict';
    import { randomUUID } from 'node:crypto';
    const { root, save, load } = await import('./scripts/stand/state.mjs');
    const { closeout } = await import('./scripts/stand/closeout.mjs');
    const { run, stopChildren } = await import('./scripts/stand/process.mjs');
    for (const id of ['first', 'second']) {
      const attempt = randomUUID();
      await save({ version: 1, id, uuid: randomUUID(), attempt, worktree: root,
        purpose: 'e2e', topology: 'path', mocked: true, state: 'allocated',
        snapshot: root + '/.amcore/stands/' + id + '/source-' + attempt });
    }
    const first = await load('first');
    const child = run(process.execPath, ['-e', 'setInterval(() => {}, 1000)', first.snapshot],
      { capture: true }).catch(error => error);
    try {
      await new Promise(resolve => setTimeout(resolve, 100));
      await assert.rejects(() => closeout(), /surviv/i);
      assert.equal((await load('first')).closeout.incomplete, true);
      assert.equal((await load('second')).state, 'allocated');
    } finally { await stopChildren(); await child; }
    await closeout();
    for (const id of ['first', 'second']) {
      const m = await load(id);
      assert.equal(m.state, 'purged');
      assert.ok(m.closeout.verifiedAt);
      assert.equal(m.closeout.incomplete, undefined);
    }
  `
  let verified = false
  try {
    const output = await run(process.execPath, ['--input-type=module', '-e', program], {
      cwd: fixture,
      capture: true,
    })
    assert.match(output, /Closeout verified/)
    verified = true
  } finally {
    // A failed proof keeps its recovery location for inspection.
    if (verified) await rm(fixture, { recursive: true })
    else console.error(`Closeout proof incomplete; recovery retained: ${fixture}`)
  }
})
