import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { run, stopChildren, setJournal, children } from './process.mjs'
import { directory, root, lease, save, load } from './state.mjs'
import { closeoutStand } from './closeout.mjs'
import { processTable, observeGroup } from './process-groups.mjs'

for (const detached of [false, true])
  test(`exited leader retains short-title TERM-resistant descendant detached=${detached} until group KILL and absence proof`, async () => {
    const id = `descendant-${randomUUID()}`
    const held = await lease(id, 'proof')
    const attempt = randomUUID()
    const m = {
      version: 1,
      id,
      uuid: randomUUID(),
      attempt,
      worktree: root,
      purpose: 'e2e',
      topology: 'path',
      mocked: true,
      state: 'allocated',
      snapshot: `${directory(id)}/source-${attempt}`,
    }
    await mkdir(m.snapshot)
    await save(m)
    setJournal(`${directory(id)}/lease/children.json`)
    const foreign = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      detached: true,
      stdio: 'ignore',
    })
    let group, worker
    const body = `process.title='t016-worker'; process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);`
    const parent = `const {spawn}=require('node:child_process'); const fs=require('node:fs');
    const c=spawn(process.execPath,['-e',${JSON.stringify(body)}],{stdio:'ignore',detached:${detached}}); c.unref();
    fs.writeFileSync('worker.pid',String(c.pid));
    const timer=setInterval(()=>{if(fs.existsSync('release')) clearInterval(timer)},10);`
    const leader = run(process.execPath, ['-e', parent], { cwd: m.snapshot, capture: true })
    try {
      for (let n = 0; n < 200; n++) {
        worker = Number(await readFile(`${m.snapshot}/worker.pid`, 'utf8').catch(() => '0'))
        const entry = JSON.parse(await readFile(`${directory(id)}/lease/children.json`, 'utf8'))[0]
        if (
          worker &&
          [entry, ...(entry?.groups ?? [])].some((group) =>
            group?.members?.some((row) => row.pid === worker)
          )
        ) {
          group = entry.pid
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      assert.ok(group, 'descendant identity was not recorded while leader lived')
      await writeFile(`${m.snapshot}/release`, '')
      await leader
      assert.equal(children.size, 1)
      await assert.rejects(() => closeoutStand(m), /surviv/)
      assert.equal((await load(id)).closeout.incomplete, true)
      const started = Date.now()
      await stopChildren()
      assert.ok(Date.now() - started >= 4900, 'TERM-resistant worker did not reach escalation')
      assert.ok(!processTable().some((row) => row.pgid === group || row.pid === worker))
      assert.deepEqual(
        JSON.parse(await readFile(`${directory(id)}/lease/children.json`, 'utf8')),
        []
      )
      process.kill(foreign.pid, 0)
      await closeoutStand(m)
      assert.ok((await load(id)).closeout.verifiedAt)
    } finally {
      if (group && processTable().some((row) => row.pgid === group)) await stopChildren()
      foreign.kill('SIGKILL')
      await once(foreign, 'close')
      setJournal(undefined)
      await held.release()
      await rm(directory(id), { recursive: true })
    }
  })

test('unproved or reused group identity refuses signalling', () => {
  const child = { pid: 777777, standMembers: [{ pid: 777778, started: 'original birth' }] }
  assert.throws(
    () => observeGroup(child, [{ pid: 777778, pgid: 777777, started: 'reused birth' }]),
    /unproved or reused/
  )
})
