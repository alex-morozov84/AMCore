import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { probe, ready, eventually } from './client.mjs'
import { configure, compose } from './fixture.mjs'
import { removeContainer } from '../migrator-lifecycle/resources.mjs'
import { isolatedContainer } from '../migrator-lifecycle/docker.mjs'
import { ledger } from '../migrator-operations/history.mjs'
import { ownership } from '../migrator-operations/roles.mjs'
import { emit } from '../migrator-operations/context.mjs'

function releaseGate(f, phase) {
  const lock = process.env.AMCORE_MIGRATOR_RELEASE_LOCK
  assert.ok(lock && isAbsolute(lock), 'Run the entire application fixture under its own flock')
  const contender = spawnSync('flock', ['--nonblock', lock, 'true'], { timeout: 2000 })
  assert.equal(contender.error, undefined)
  assert.equal(contender.signal, null)
  assert.equal(contender.status, 1, 'A second release acquired the coordinator lock')
  emit(f, `release-coordination-${phase}`, { contenderDenied: true })
}

export async function gates(f) {
  releaseGate(f, 'before-migration')
  await configure(f, f.current, f.current, 'amcore_runtime')
  await compose(f, ['up', '-d', '--no-build', '--pull', 'never', 'api', 'worker'], 1)
  const [migration] = JSON.parse(await f.docker(['inspect', f.names.migrate]))
  assert.equal(migration.State.Running, false)
  assert.ok(migration.State.ExitCode > 0)
  assert.equal(migration.State.OOMKilled, false)
  assert.equal(migration.State.Error, '')
  for (const name of [f.names.api, f.names.worker]) {
    const [c] = JSON.parse(await f.docker(['inspect', name]))
    assert.equal(c.State.Running, false)
    assert.equal(c.State.StartedAt, '0001-01-01T00:00:00Z')
  }
  emit(f, 'application-migration-failure-gate', { apiStarted: false, workerStarted: false })
  for (const name of [f.names.api, f.names.worker, f.names.migrate]) await removeContainer(f, name)
  await configure(f, f.current, f.current)
  await compose(f, ['up', '--no-build', '--pull', 'never', 'migrate'])
  const [success] = JSON.parse(await f.docker(['inspect', f.names.migrate]))
  assert.equal(success.State.ExitCode, 0)
  assert.equal(success.State.OOMKilled, false)
  assert.equal(success.State.Error, '')
  releaseGate(f, 'after-migration-before-rollout')
  await compose(f, ['up', '-d', '--no-build', '--pull', 'never', 'api', 'worker'])
  const [lastMigration] = JSON.parse(await f.docker(['inspect', f.names.migrate]))
  assert.equal(lastMigration.State.ExitCode, 0)
  for (const name of [f.names.api, f.names.worker]) {
    await isolatedContainer(f, name)
    const [c] = JSON.parse(await f.docker(['inspect', name]))
    assert.ok(Date.parse(c.State.StartedAt) >= Date.parse(lastMigration.State.FinishedAt))
    await ready(f, name)
  }
  await ledger(f, f.admin, f.migrations)
  await ownership(f, f.admin, 'application')
  emit(f, 'application-migration-success-gate', {
    migrationFinished: true,
    apiReady: true,
    workerReady: true,
  })
}

async function stopApps(f) {
  for (const name of [f.names.api, f.names.worker]) {
    const rows = (
      await f.docker(['ps', '-a', '--filter', `name=^/${name}$`, '--format', '{{.ID}}'])
    ).trim()
    if (!rows) continue
    await compose(f, ['stop', '--timeout', '30', name === f.names.api ? 'api' : 'worker'])
    await removeContainer(f, name)
  }
}

async function request(f, name, path, body) {
  return probe(
    f,
    name,
    `const r=await fetch('http://localhost:5002/api/v1/auth/'+process.argv[1],{
    method:'POST',headers:{'content-type':'application/json'},body:process.argv[2],signal:AbortSignal.timeout(10000)});
    const b=await r.json();console.log(JSON.stringify({status:r.status,id:b.user?.id??b.data?.user?.id}))`,
    [path, JSON.stringify(body)]
  )
}

async function queued(f, name, email) {
  return probe(
    f,
    name,
    `import {createRequire} from 'node:module';const require=createRequire('/app/package.json');
    const {Queue}=require('bullmq');const q=new Queue('email',{connection:{host:'redis',port:6379}});
    try {const jobs=(await q.getJobs()).filter(j=>j.data?.payload?.to===process.argv[1]);
      console.log(JSON.stringify(await Promise.all(jobs.map(async j=>({id:j.id,state:await j.getState()})))))
    } finally {await q.close()}`,
    [email]
  )
}

export async function compatibility(f) {
  for (const producer of ['previous', 'current']) {
    for (const consumer of ['previous', 'current']) {
      await stopApps(f)
      await configure(f, f[producer], f[consumer])
      await compose(f, ['up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'api'])
      await ready(f, f.names.api)
      const email = `${producer}-${consumer}-${f.run}@example.invalid`
      const password = 'Fixture-only-password-never-real-123!'
      const registered = await request(f, f.names.api, 'register', {
        email,
        password,
        name: 'Migration fixture',
      })
      assert.equal(registered.status, 201)
      assert.ok(registered.id)
      let job
      await eventually(async () => {
        const jobs = await queued(f, f.names.api, email)
        if (!jobs.length) return false
        assert.equal(jobs.length, 1)
        assert.ok(['waiting', 'prioritized'].includes(jobs[0].state))
        job = jobs[0]
        return true
      }, 'Real producer did not enqueue welcome email')
      await stopApps(f) // Preserve queued work; start a different artifact as consumer.
      await configure(f, f[consumer], f[consumer])
      await compose(f, ['up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'worker'])
      await ready(f, f.names.worker)
      await eventually(async () => {
        const jobs = await queued(f, f.names.worker, email)
        assert.equal(jobs.length, 1)
        assert.equal(jobs[0].id, job.id)
        assert.notEqual(jobs[0].state, 'failed')
        return jobs[0].state === 'completed'
      }, 'Real worker did not complete queued welcome email')
      const evidence = (
        await f.admin.query(
          `SELECT certainty,"outcomeRecorded" FROM core.background_effect_evidence WHERE "jobId"=$1`,
          [job.id]
        )
      ).rows
      assert.equal(evidence.length, 1)
      assert.equal(evidence[0].certainty, 'accepted')
      assert.equal(evidence[0].outcomeRecorded, true)
      await compose(f, ['up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'api'])
      await ready(f, f.names.api)
      const login = await request(f, f.names.api, 'login', { email, password })
      assert.equal(login.status, 200)
      assert.equal(login.id, registered.id)
      emit(f, 'application-compatibility', {
        producer,
        consumer,
        jobId: job.id,
        queuedBeforeReplacement: true,
        completed: true,
        providerAccepted: true,
        userPreserved: true,
      })
    }
  }
}
