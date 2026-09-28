import { test } from 'node:test'
import { mkdtemp, mkdir, cp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { root } from './state.mjs'
import { run } from './process.mjs'

test('wrapper retains its lease/journal when managed runner cleanup is incomplete', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'amcore-wrapper-state-'))
  await mkdir(`${fixture}/scripts`)
  await symlink(`${root}/node_modules`, `${fixture}/node_modules`)
  await cp(`${root}/scripts/stand`, `${fixture}/scripts/stand`, {
    recursive: true,
    filter: (path) => !path.endsWith('.test.mjs'),
  })
  const program = `
    import assert from 'node:assert/strict';
    import {readFile,access} from 'node:fs/promises';
    import {randomUUID} from 'node:crypto';
    const {cancellation}=await import('./scripts/stand/cancellation.mjs');
    const {closeoutStand}=await import('./scripts/stand/closeout.mjs');
    const {root,directory,save,load}=await import('./scripts/stand/state.mjs');
    const operation=await cancellation(), id=operation.standId, attempt=randomUUID();
    const target={version:1,id,uuid:randomUUID(),attempt,worktree:root,mocked:true,
      purpose:'e2e',topology:'path',snapshot:directory(id)+'/source-'+attempt,state:'cleanup-failed'};
    await save(target);
    await assert.rejects(()=>operation.finish(),/Managed runner cleanup incomplete/);
    const wrapperId=id.slice(0,-4), record=await load(wrapperId);
    assert.equal(record.closeout.incomplete,true);
    await assert.rejects(()=>closeoutStand(record),/Managed runner cleanup incomplete/);
    await access(directory(wrapperId)+'/lease/owner.json');
    assert.deepEqual(JSON.parse(await readFile(directory(wrapperId)+'/lease/children.json','utf8')),[]);
    target.state='purged'; await save(target); await operation.finish();
    assert.ok((await load(wrapperId)).closeout.verifiedAt);
    await assert.rejects(()=>access(directory(wrapperId)+'/lease'),{code:'ENOENT'});
  `
  let verified = false
  try {
    await run(process.execPath, ['--input-type=module', '-e', program], {
      cwd: fixture,
      capture: true,
    })
    verified = true
  } finally {
    if (verified) await rm(fixture, { recursive: true })
    else console.error(`Wrapper state proof incomplete; retain recovery: ${fixture}`)
  }
})
