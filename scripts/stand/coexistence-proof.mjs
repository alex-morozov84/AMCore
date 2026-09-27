import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { root, stateRoot } from './state.mjs'
import { snapshot } from './snapshot.mjs'
import { run, cleanEnvironment, stopChildren } from './process.mjs'

const dir = `${stateRoot}/coexist-${randomUUID()}`
const fixtures = [`${dir}/checkout-a`, `${dir}/checkout-b`]
let hits = 0
const payload = 'foreign sentinel data remains unchanged'
const digest = createHash('sha256').update(payload).digest('hex')
const sentinel = createServer((_req, res) => {
  hits++
  res.end(payload)
})
await new Promise((resolve, reject) => {
  sentinel.once('error', reject)
  sentinel.listen(3002, '127.0.0.1', resolve)
})
try {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  for (const cwd of fixtures) {
    await snapshot(root, cwd)
    await run('git', ['init', '--quiet'], { cwd })
    await writeFile(
      `${cwd}/.env`,
      'DATABASE_URL=postgresql://fake:fake@foreign.invalid:5432/foreign\nREDIS_URL=redis://foreign.invalid:6379\nAPI_URL=http://127.0.0.1:3002\n',
      { mode: 0o600 }
    )
    await run('pnpm', ['install', '--frozen-lockfile'], { cwd, env: cleanEnvironment() })
  }
  const env = cleanEnvironment({
    CI: 'true',
    DATABASE_URL: 'postgresql://fake:fake@foreign.invalid:5432/foreign',
    E2E_DATABASE_URL: 'postgresql://fake:fake@foreign.invalid:5432/foreign',
    REDIS_URL: 'redis://foreign.invalid:6379',
    DOCKER_HOST: 'ssh://foreign.invalid',
    COMPOSE_FILE: '/foreign.yml',
    API_URL: 'http://127.0.0.1:3002',
  })
  const results = await Promise.allSettled(
    fixtures.map((cwd) =>
      run(process.execPath, ['scripts/stand.mjs', 'e2e', '--lane', 'mocked', '--id', 'same-id'], {
        cwd,
        env,
      })
    )
  )
  for (const result of results) if (result.status === 'rejected') throw result.reason
  const manifests = await Promise.all(
    fixtures.map((cwd) =>
      readFile(`${cwd}/.amcore/stands/same-id/manifest.json`, 'utf8').then(JSON.parse)
    )
  )
  assert.notEqual(manifests[0].uuid, manifests[1].uuid)
  assert.notEqual(manifests[0].snapshot, manifests[1].snapshot)
  assert.notEqual(manifests[0].ports.web, manifests[1].ports.web)
  for (const m of manifests) {
    assert.equal(m.testOutcome, 'passed')
    assert.equal(m.engine, undefined)
    await readFile(`${m.worktree}/.amcore/stands/same-id/report/index.html`)
    await readFile(`${m.snapshot}/apps/web/.next/build-manifest.json`)
  }
  assert.equal(hits, 0)
  assert.equal(createHash('sha256').update(payload).digest('hex'), digest)
  await writeFile(
    `${dir}/proof.json`,
    JSON.stringify(
      {
        passed: true,
        sentinelPort: 3002,
        hits,
        digest,
        runs: manifests.map(({ uuid, snapshot, worktree, ports, sourceHash }) => ({
          uuid,
          snapshot,
          worktree,
          ports,
          sourceHash,
        })),
      },
      null,
      2
    )
  )
  console.log(
    `Two-checkout mocked coexistence passed; sentinel requests=0. Evidence: ${dir}/proof.json`
  )
} finally {
  await stopChildren()
  sentinel.closeAllConnections()
  await new Promise((resolve) => sentinel.close(resolve))
  // Keep isolated reports/evidence for review; all server children are awaited.
}
