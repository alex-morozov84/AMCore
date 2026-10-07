import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { create } from './create.mjs'
import { builtServices, configuration, labels, validateModel } from './config.mjs'
import { docker } from './docker.mjs'
import { cleanup } from './ownership.mjs'
import { closeoutStand } from './closeout.mjs'
import { run } from './process.mjs'
import { directory, lease, load, root, save } from './state.mjs'

// Real Docker engine, real Compose rendering, scratch images only: no pulls, no app builds.
// `image ls` prints one line per reference, so an aliased image appears twice.
const census = (m) =>
  docker(
    m,
    ['image', 'ls', '-a', '-q', '--no-trunc', '--filter', `label=org.amcore.stand=${m.uuid}`],
    { capture: true }
  ).then((output) => [...new Set(output.split('\n').filter(Boolean))])

async function scratchContext() {
  const dir = await mkdtemp(join(tmpdir(), 'amcore-image-proof-'))
  await writeFile(join(dir, 'f'), 'x')
  await writeFile(join(dir, 'Dockerfile'), 'FROM scratch\nCOPY f /f\n')
  return dir
}

async function buildOwned(m, context, services = builtServices) {
  for (const service of services) {
    const tags = { ...labels(m), 'com.docker.compose.project': m.project }
    tags['com.docker.compose.service'] = service
    const flags = Object.entries(tags).flatMap(([key, value]) => ['--label', `${key}=${value}`])
    await docker(m, ['build', '-q', '-t', `${m.project}-${service}`, ...flags, context], {
      capture: true,
    })
  }
}

// What the classic image store does on Linux: identical builds become one image that
// carries several generated names and a single `com.docker.compose.service` label.
async function buildShared(m, context, dropServiceLabel) {
  const tags = { ...labels(m), 'com.docker.compose.project': m.project }
  if (!dropServiceLabel) tags['com.docker.compose.service'] = 'api'
  const flags = Object.entries(tags).flatMap(([key, value]) => ['--label', `${key}=${value}`])
  const names = ['api', 'worker'].flatMap((service) => ['-t', `${m.project}-${service}`])
  await docker(m, ['build', '-q', ...names, ...flags, context], { capture: true })
}

async function withStand(name, body) {
  const id = `${name}-${randomUUID()}`
  const held = await lease(id, 'image-lifecycle-proof')
  const context = await scratchContext()
  const extra = []
  let m
  try {
    m = await create(id, 'e2e', 'path')
    await configuration(m)
    await save(m)
    await body(m, context, extra)
  } finally {
    // Only this test's own scratch resources, by exact name.
    for (const [kind, name] of extra) await docker(m, [kind, 'rm', '-f', name]).catch(() => {})
    for (const service of builtServices)
      await docker(m, ['image', 'rm', '-f', `${m.project}-${service}`]).catch(() => {})
    await held.release()
    await rm(context, { recursive: true, force: true })
    await rm(directory(id), { recursive: true, force: true })
  }
}

test('overlay labels exactly the built images, and validation rejects tampered models', async () => {
  await withStand('image-labels', async (m) => {
    for (const service of builtServices)
      for (const [key, value] of Object.entries(labels(m)))
        assert.equal(m.model.services[service].build.labels[key], value, `${service} ${key}`)
    for (const service of ['postgres', 'redis'])
      assert.equal(m.model.services[service].build, undefined)
    const missing = globalThis.structuredClone(m)
    delete missing.model.services.api.build.labels['org.amcore.attempt']
    assert.throws(() => validateModel(missing), /Unowned api image labels/)
    const pulled = globalThis.structuredClone(m)
    pulled.model.services.postgres.build = { labels: labels(m) }
    assert.throws(() => validateModel(pulled), /Unowned postgres image labels/)
  })
})

test('purge removes proved images by ID, keeps pulled images and is idempotent', async () => {
  await withStand('image-purge', async (m, context) => {
    const pulled = await docker(
      m,
      ['image', 'inspect', 'postgres:18-alpine', '--format', '{{.Id}}'],
      {
        capture: true,
      }
    ).catch(() => '')
    await buildOwned(m, context)
    m.builds = [{ invocation: 'proof', state: 'settled', outcome: 'succeeded' }]
    await save(m)
    assert.equal((await census(m)).length, 4)
    await cleanup(m, true)
    assert.equal(m.state, 'purged')
    assert.deepEqual(await census(m), [])
    assert.ok(m.imageDisposal.verifiedAt)
    const after = await docker(
      m,
      ['image', 'inspect', 'postgres:18-alpine', '--format', '{{.Id}}'],
      {
        capture: true,
      }
    ).catch(() => '')
    // A clean runner may not have the base image yet (another test can pull it meanwhile),
    // so compare only when it was present before.
    if (pulled) assert.equal(after, pulled, 'pulled base images are never touched')
    await cleanup(m, true)
    assert.equal(m.state, 'purged')
  })
})

test('one image carrying the api and worker names (classic store behaviour) is purged', async () => {
  for (const dropServiceLabel of [false, true])
    await withStand('image-shared', async (m, context) => {
      await buildShared(m, context, dropServiceLabel)
      await buildOwned(m, context, ['web'])
      const shared = await docker(
        m,
        ['image', 'inspect', `${m.project}-api`, '--format', '{{.Id}} {{len .RepoTags}}'],
        { capture: true }
      )
      assert.match(shared.trim(), /^sha256:[0-9a-f]{64} 2$/, 'one image with two generated names')
      assert.equal((await census(m)).length, 2)
      m.builds = [{ invocation: 'proof', state: 'settled', outcome: 'succeeded' }]
      await save(m)
      await cleanup(m, true)
      assert.equal(m.state, 'purged')
      assert.deepEqual(await census(m), [])
      for (const service of ['api', 'worker', 'web'])
        await assert.rejects(
          () => docker(m, ['image', 'inspect', `${m.project}-${service}`], { capture: true }),
          /No such/
        )
    })
})

test('ordinary stop keeps images; an unresolved build keeps the record until acceptance', async () => {
  await withStand('image-unresolved', async (m, context) => {
    await buildOwned(m, context, ['api', 'web'])
    await cleanup(m, false)
    assert.equal((await census(m)).length, 2, 'non-purge never removes images')

    m.builds = [{ invocation: 'unresolved', state: 'pending', startedAt: new Date().toISOString() }]
    await save(m)
    await assert.rejects(() => cleanup(m, true), { code: 'BUILD_UNRESOLVED' })
    assert.deepEqual(await census(m), [], 'proved-owned images are still removed')
    assert.equal((await load(m.id)).state, 'cleanup-incomplete')
    assert.equal((await load(m.id)).cleanup.code, 'BUILD_UNRESOLVED')
    assert.equal((await load(m.id)).builds[0].state, 'pending')
    await assert.rejects(() => closeoutStand(m), { code: 'BUILD_UNRESOLVED' })
    assert.equal((await load(m.id)).closeout.incomplete, true)

    await assert.rejects(
      () => cleanup(m, true, { acceptReason: 'short' }),
      /requires a written reason/
    )
    assert.equal(m.state, 'cleanup-incomplete', 'a refused acceptance is still incomplete')
    await cleanup(m, true, { acceptReason: 'integration proof accepts the unresolved attempt' })
    assert.equal(m.state, 'purged')
    assert.equal(m.builds[0].state, 'accepted-risk')
    assert.equal(m.cleanup.incomplete, undefined, 'the latest result replaced the failure')
    await closeoutStand(m)
    const stored = (await load(m.id)).closeout
    assert.ok(stored.verifiedAt)
    assert.equal(stored.acceptedRisk[0].invocation, 'unresolved')
    assert.match(stored.acceptedRisk[0].reason, /accepts the unresolved attempt/)
  })
})

test('a proved build disposition leaves no accepted-risk record in the closeout result', async () => {
  await withStand('image-proved', async (m, context) => {
    await buildOwned(m, context, ['api'])
    m.builds = [{ invocation: 'proved', state: 'settled', outcome: 'succeeded' }]
    await save(m)
    await closeoutStand(m)
    const stored = (await load(m.id)).closeout
    assert.ok(stored.verifiedAt)
    assert.equal(stored.acceptedRisk, undefined)
  })
})

test('an image exported after an empty census is found by the next purge, never by luck', async () => {
  await withStand('image-late', async (m, context) => {
    m.builds = [{ invocation: 'late', state: 'pending', startedAt: new Date().toISOString() }]
    await save(m)
    await assert.rejects(() => cleanup(m, true), { code: 'BUILD_UNRESOLVED' })
    assert.deepEqual(await census(m), [], 'nothing existed yet: an empty census proves nothing')
    assert.equal((await load(m.id)).state, 'cleanup-incomplete', 'the record outlives it')

    await buildOwned(m, context, ['api', 'web']) // the daemon finishes exporting later
    assert.equal((await census(m)).length, 2)
    await assert.rejects(() => closeoutStand(m), { code: 'BUILD_UNRESOLVED' })
    assert.deepEqual(await census(m), [], 'the late images are proved and removed')
    assert.equal((await load(m.id)).state, 'cleanup-incomplete')
    await cleanup(m, true, { acceptReason: 'late export test accepts after removal' })
    assert.equal(m.state, 'purged')
  })
})

test('a removal conflict is recorded as failed, replaces a stale purged state and is retryable', async () => {
  await withStand('image-conflict', async (m, context, extra) => {
    await cleanup(m, true)
    assert.equal(m.state, 'purged')
    assert.ok(m.cleanup.verifiedAt)

    await buildOwned(m, context, ['api']) // a late export for an already purged allocation
    const alias = `amcore-image-proof-alias-${randomUUID().slice(0, 8)}:keep`
    extra.push(['image', alias])
    await docker(m, ['image', 'tag', `${m.project}-api`, alias])
    await assert.rejects(() => cleanup(m, true), /Foreign image reference/)
    for (const record of [m, await load(m.id)]) {
      assert.equal(record.state, 'cleanup-failed', 'never a stale purged')
      assert.equal(record.cleanup.incomplete, true)
      assert.equal(record.cleanup.code, undefined, 'a conflict is not an unresolved build')
      assert.match(record.cleanup.reason, /Foreign image reference/)
    }
    await assert.rejects(() => closeoutStand(m), /Foreign image reference/)
    assert.equal((await load(m.id)).state, 'cleanup-failed')
    assert.equal((await load(m.id)).closeout.incomplete, true)

    await docker(m, ['image', 'rm', alias])
    await cleanup(m, true)
    assert.equal(m.state, 'purged')
    assert.equal(m.cleanup.incomplete, undefined)
    assert.deepEqual(await census(m), [])
  })
})

test('closeout output separates verified absence from accepted unresolved-build risk', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'amcore-risk-closeout-'))
  await mkdir(`${fixture}/scripts`)
  await symlink(`${root}/node_modules`, `${fixture}/node_modules`)
  await cp(`${root}/scripts/stand`, `${fixture}/scripts/stand`, {
    recursive: true,
    filter: (path) => !path.endsWith('.test.mjs'),
  })
  const program = `
    import { randomUUID } from 'node:crypto';
    const { root, save } = await import('./scripts/stand/state.mjs');
    const { closeout } = await import('./scripts/stand/closeout.mjs');
    for (const [id, builds] of [
      ['proved', [{ invocation: 'inv-proved', state: 'settled', outcome: 'succeeded' }]],
      ['risky', [{ invocation: 'inv-risky', state: 'accepted-risk',
        acceptance: { reason: 'owner accepted after manual daemon check', at: 'now' } }]],
    ]) {
      const attempt = randomUUID();
      await save({ version: 1, id, uuid: randomUUID(), attempt, worktree: root, purpose: 'e2e',
        topology: 'path', mocked: true, state: 'allocated', builds,
        snapshot: root + '/.amcore/stands/' + id + '/source-' + attempt });
    }
    await closeout();
  `
  try {
    const output = await run(process.execPath, ['--input-type=module', '-e', program], {
      cwd: fixture,
      capture: true,
    })
    assert.match(output, /risky: processes\/resources removed\n\s+ACCEPTED RISK \(not proof/)
    assert.match(output, /inv-risky: owner accepted after manual daemon check/)
    assert.doesNotMatch(output, /inv-proved/)
    assert.match(
      output,
      /Closeout verified physical absence only; unresolved-build risk was ACCEPTED for 1/
    )
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('a foreign alias or a foreign container refuses removal; retry after cleanup succeeds', async () => {
  await withStand('image-foreign', async (m, context, extra) => {
    await buildOwned(m, context, ['api', 'web'])
    const alias = `amcore-image-proof-alias-${randomUUID().slice(0, 8)}:keep`
    extra.push(['image', alias])
    await docker(m, ['image', 'tag', `${m.project}-api`, alias])
    await assert.rejects(() => cleanup(m, true), /Foreign image reference/)
    assert.equal((await census(m)).length, 2, 'nothing was removed')
    await docker(m, ['image', 'rm', alias])

    // The ordinary unmanaged case: `docker create` from a stand image with NO label
    // override. The container inherits the stand tuple and Compose project/service, but
    // not the labels Compose sets on containers it creates, so it must not be adopted.
    const inherited = `amcore-image-proof-ctr-${randomUUID().slice(0, 8)}`
    extra.push(['container', inherited])
    await docker(m, ['create', '--name', inherited, `${m.project}-web`, '/f'])
    await assert.rejects(() => cleanup(m, true), /Container lacks Compose creation evidence/)
    assert.equal((await census(m)).length, 2, 'the image is preserved')
    await docker(m, ['container', 'inspect', inherited]) // and so is the container
    await docker(m, ['rm', inherited])

    // A container that carries another stand's label is outside this stand's census; the
    // image reference check still refuses removal.
    const container = `amcore-image-proof-ctr-${randomUUID().slice(0, 8)}`
    extra.push(['container', container])
    await docker(m, [
      ...['create', '--name', container, '--label', 'org.amcore.stand=foreign-stand'],
      `${m.project}-web`,
      '/f',
    ])
    await assert.rejects(() => cleanup(m, true), /referenced by a container/)
    assert.equal((await census(m)).length, 2)
    await docker(m, ['rm', container])

    await cleanup(m, true)
    assert.equal(m.state, 'purged')
    assert.deepEqual(await census(m), [])
  })
})

test('closeout refuses an image labelled for the worktree and passes once it is gone', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'amcore-image-closeout-'))
  await mkdir(`${fixture}/scripts`)
  await symlink(`${root}/node_modules`, `${fixture}/node_modules`)
  await cp(`${root}/scripts/stand`, `${fixture}/scripts/stand`, {
    recursive: true,
    filter: (path) => !path.endsWith('.test.mjs'),
  })
  const tag = `amcore-image-closeout-${randomUUID().slice(0, 8)}:proof`
  const program = `
    import assert from 'node:assert/strict';
    import { mkdir, writeFile } from 'node:fs/promises';
    const { root } = await import('./scripts/stand/state.mjs');
    const { closeout } = await import('./scripts/stand/closeout.mjs');
    const { run } = await import('./scripts/stand/process.mjs');
    await mkdir('ctx');
    await writeFile('ctx/f', 'x');
    await writeFile('ctx/Dockerfile', 'FROM scratch\\nCOPY f /f\\n');
    await run('docker', ['build', '-q', '-t', '${tag}', '--label', 'org.amcore.worktree=' + root, 'ctx'], { capture: true });
    try {
      await assert.rejects(() => closeout(), /Unrecorded image remains/);
    } finally {
      await run('docker', ['image', 'rm', '-f', '${tag}'], { capture: true });
    }
    await closeout();
  `
  try {
    const output = await run(process.execPath, ['--input-type=module', '-e', program], {
      cwd: fixture,
      capture: true,
    })
    assert.match(output, /Closeout verified/)
  } finally {
    await run('docker', ['image', 'rm', '-f', tag], { capture: true }).catch(() => {})
    await rm(fixture, { recursive: true, force: true })
  }
})
