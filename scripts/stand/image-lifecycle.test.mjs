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
    assert.equal(after, pulled, 'pulled base images are never touched')
    await cleanup(m, true)
    assert.equal(m.state, 'purged')
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
    assert.equal((await load(m.id)).builds[0].state, 'pending')
    await assert.rejects(() => closeoutStand(m), { code: 'BUILD_UNRESOLVED' })
    assert.equal((await load(m.id)).closeout.incomplete, true)

    await assert.rejects(
      () => cleanup(m, true, { acceptReason: 'short' }),
      /requires a written reason/
    )
    await cleanup(m, true, { acceptReason: 'integration proof accepts the unresolved attempt' })
    assert.equal(m.state, 'purged')
    assert.equal(m.builds[0].state, 'accepted-risk')
    await closeoutStand(m)
    assert.ok((await load(m.id)).closeout.verifiedAt)
  })
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

    const container = `amcore-image-proof-ctr-${randomUUID().slice(0, 8)}`
    extra.push(['container', container])
    // A container inherits its image's labels, so a container from this image would look
    // like the stand's own. Override the stand label to make it genuinely foreign.
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
