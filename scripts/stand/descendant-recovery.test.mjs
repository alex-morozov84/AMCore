import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { directory, root, load } from './state.mjs'
import { run, stopChildren } from './process.mjs'
import { recover } from './recovery.mjs'
import { processTable } from './process-groups.mjs'

test('controller crash keeps exited-leader descendant journal and recovery refuses the live group', async () => {
  const id = `descendant-crash-${randomUUID()}`
  const dir = directory(id)
  const program = `
    import {writeFile,mkdir,access} from 'node:fs/promises';
    import {randomUUID} from 'node:crypto';
    const {lease,save,root,directory}=await import('./scripts/stand/state.mjs');
    const {run,setJournal}=await import('./scripts/stand/process.mjs');
    const id=${JSON.stringify(id)}, dir=directory(id), attempt=randomUUID();
    await lease(id,'crash-proof'); setJournal(dir+'/lease/children.json');
    const snapshot=dir+'/source-'+attempt; await mkdir(snapshot);
    await save({version:1,id,uuid:randomUUID(),attempt,worktree:root,mocked:true,
      purpose:'e2e',topology:'path',snapshot,state:'allocated'});
    const worker="process.title='t016-crash-worker'; setInterval(()=>{},1000)";
    const parent="const {spawn}=require('node:child_process'); const fs=require('node:fs'); const c=spawn(process.execPath,['-e',"+JSON.stringify(worker)+"],{stdio:'ignore'}); c.unref(); fs.writeFileSync('worker.pid',String(c.pid)); const t=setInterval(()=>{if(fs.existsSync('release'))clearInterval(t)},10)";
    await run(process.execPath,['-e',parent],{cwd:snapshot,capture:true});
    await writeFile(dir+'/leader-exited',''); setInterval(()=>{},1000);
  `
  const controller = run(process.execPath, ['--input-type=module', '-e', program], {
    cwd: root,
    capture: true,
  })
  const ended = assert.rejects(controller, /SIGKILL/)
  let owner, group, m
  try {
    for (let n = 0; n < 250; n++) {
      m = await load(id).catch(() => undefined)
      const entries = JSON.parse(
        await readFile(`${dir}/lease/children.json`, 'utf8').catch(() => '[]')
      )
      if (entries[0]?.members?.length > 1) {
        group = entries[0]
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.ok(group, 'descendant group not admitted')
    await writeFile(`${m.snapshot}/release`, '')
    for (let n = 0; n < 100; n++) {
      if (
        await readFile(`${dir}/leader-exited`).then(
          () => true,
          () => false
        )
      )
        break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    await readFile(`${dir}/leader-exited`)
    owner = JSON.parse(await readFile(`${dir}/lease/owner.json`, 'utf8'))
    process.kill(owner.pid, 'SIGKILL')
    await ended
    await assert.rejects(() => recover(id, true), /group alive/)
    assert.ok(JSON.parse(await readFile(`${dir}/lease/children.json`, 'utf8')).length)
    const live = processTable().filter((row) => row.pgid === group.pid)
    assert.ok(
      live.some((row) =>
        group.members.some((known) => known.pid === row.pid && known.started === row.started)
      )
    )
    process.kill(-group.pid, 'SIGTERM')
    for (let n = 0; n < 100 && processTable().some((row) => row.pgid === group.pid); n++)
      await new Promise((resolve) => setTimeout(resolve, 30))
    await recover(id, true)
    assert.equal((await load(id)).state, 'purged')
  } finally {
    await stopChildren()
    await rm(dir, { recursive: true })
  }
})
