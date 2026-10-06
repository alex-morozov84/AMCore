import { test } from 'node:test'
import assert from 'node:assert/strict'
import { labels, builtServices } from './config.mjs'
import { disposeImages, imageCensus, ownedImage, worktreeImages } from './image-census.mjs'

const m = {
  uuid: '11111111-1111-4111-8111-111111111111',
  attempt: '22222222-2222-4222-8222-222222222222',
  worktree: '/work/tree',
  project: 'amcore-abcd1234-e2e-111111111111',
}
const hex = (n) => `sha256:${n.toString(16).padStart(64, '0')}`

function image(n, service = 'api', patch = {}) {
  const repository = `${m.project}-${service}`
  return {
    Id: hex(n),
    Config: {
      Labels: {
        ...labels(m),
        'com.docker.compose.project': m.project,
        'com.docker.compose.service': service,
      },
    },
    RepoTags: [`${repository}:latest`],
    RepoDigests: [`${repository}@${hex(n)}`],
    ...patch,
  }
}

const dockerError = (stderr) => Object.assign(new Error(`docker failed: ${stderr}`), { stderr })

// Minimal in-memory engine: only the commands the census/disposal may issue.
function fakeDocker({ images = [], containers = [], keepAfterRemove = [] } = {}) {
  const state = { images: [...images], calls: [], events: [] }
  const find = (id) => state.images.find((item) => item.Id === id)
  const execute = async (args) => {
    state.calls.push(args.join(' '))
    const [group, verb] = args
    if (group === 'image' && verb === 'ls') {
      const [, kv] = args[args.indexOf('--filter') + 1].split('label=')
      const at = kv.indexOf('=')
      const [key, value] = [kv.slice(0, at), kv.slice(at + 1)]
      return state.images
        .filter((item) => item.Config.Labels[key] === value)
        .flatMap((item) => (item.listedTwice ? [item.Id, item.Id] : [item.Id]))
        .join('\n')
    }
    if (group === 'image' && verb === 'inspect') {
      const found = args.slice(2).map((id) => {
        const item = find(id)
        if (!item) throw dockerError(`Error response from daemon: No such image: ${id}`)
        return item
      })
      return JSON.stringify(found)
    }
    if (group === 'container' && verb === 'ls') return containers.map((c) => c.Id).join('\n')
    if (group === 'container' && verb === 'inspect')
      return JSON.stringify(args.slice(2).map((id) => containers.find((c) => c.Id === id)))
    if (group === 'image' && verb === 'rm') {
      assert.equal(args[2], '--no-prune')
      const item = find(args[3])
      if (!item) throw dockerError(`Error response from daemon: No such image: ${args[3]}`)
      if ((item.RepoTags ?? []).length > 1)
        throw dockerError(
          'conflict: unable to delete (must be forced) - referenced in multiple repositories'
        )
      state.events.push(`rm:${args[3]}`)
      if (!keepAfterRemove.includes(args[3]))
        state.images = state.images.filter((other) => other !== item)
      return ''
    }
    throw new Error(`unexpected docker call: ${args.join(' ')}`)
  }
  return { state, execute }
}

const noSave = async () => {}

test('ownership proof accepts each built service with its exact generated references', () => {
  for (const service of builtServices) assert.equal(ownedImage(m, image(1, service)), service)
  assert.equal(ownedImage(m, image(2, 'api', { RepoTags: [], RepoDigests: [] })), 'api')
  assert.equal(ownedImage(m, image(3, 'web', { RepoTags: null, RepoDigests: null })), 'web')
})

test('ownership proof refuses every deviation from the full tuple and reference set', () => {
  const labelled = (patch) => {
    const item = image(4)
    Object.assign(item.Config.Labels, patch)
    return item
  }
  const refused = [
    ['other stand', labelled({ 'org.amcore.stand': '33333333-3333-4333-8333-333333333333' })],
    ['other attempt', labelled({ 'org.amcore.attempt': '44444444-4444-4444-8444-444444444444' })],
    ['other worktree', labelled({ 'org.amcore.worktree': '/other' })],
    ['other project', labelled({ 'com.docker.compose.project': 'amcore-other' })],
    ['pulled service', labelled({ 'com.docker.compose.service': 'postgres' })],
    ['missing service', labelled({ 'com.docker.compose.service': undefined })],
    ['short id', image(5, 'api', { Id: 'sha256:abc' })],
    ['foreign sole tag', image(6, 'api', { RepoTags: ['postgres:18-alpine'] })],
    ['tag suffix', image(7, 'api', { RepoTags: [`${m.project}-api:other`] })],
    ['prefix match', image(8, 'api', { RepoTags: [`${m.project}-apix:latest`] })],
    ['wrong service tag', image(9, 'api', { RepoTags: [`${m.project}-web:latest`] })],
    ['extra alias', image(10, 'api', { RepoTags: [`${m.project}-api:latest`, 'alias:latest'] })],
    ['foreign digest', image(11, 'api', { RepoDigests: [`registry.example/x@${hex(11)}`] })],
  ]
  for (const [name, item] of refused)
    assert.throws(
      () => ownedImage(m, item),
      /Unproved image ownership|Foreign image reference/,
      name
    )
})

test('census deduplicates repeated IDs and finds partial or dangling generations without a map', async () => {
  const { execute } = fakeDocker({
    images: [
      { ...image(1, 'api'), listedTwice: true },
      image(2, 'web', { RepoTags: [], RepoDigests: [] }),
    ],
  })
  const found = await imageCensus(m, execute)
  assert.deepEqual(found.map((item) => [item.id, item.service]).sort(), [
    [hex(1), 'api'],
    [hex(2), 'web'],
  ])
  assert.deepEqual(await imageCensus(m, fakeDocker().execute), [])
})

test('census fails closed on malformed, incomplete or unproved results', async () => {
  const short = fakeDocker({ images: [image(1, 'api', { Id: 'sha256:abc' })] })
  await assert.rejects(() => imageCensus(m, short.execute), /Incomplete image identity/)
  const foreign = fakeDocker({ images: [image(2, 'api', { RepoTags: ['x:latest'] })] })
  await assert.rejects(() => imageCensus(m, foreign.execute), /Foreign image reference/)
  const incomplete = async (args) =>
    args[1] === 'ls' ? `${hex(1)}\n${hex(2)}` : JSON.stringify([image(1)])
  await assert.rejects(() => imageCensus(m, incomplete), /Incomplete resource inspection/)
  const transport = async () => {
    throw dockerError('Cannot connect to the Docker daemon')
  }
  await assert.rejects(() => imageCensus(m, transport), /Cannot connect/)
})

test('disposal removes only proved IDs without force, tag or prune, persisting first', async () => {
  const docker = fakeDocker({ images: [image(1, 'api'), image(2, 'web'), image(3, 'worker')] })
  const execute = async (args, options) => {
    if (args[1] === 'rm') docker.state.events.push('about-to-rm')
    return docker.execute(args, options)
  }
  const saved = []
  const removed = await disposeImages(m, execute, async (manifest) => {
    docker.state.events.push('save')
    saved.push(globalThis.structuredClone(manifest.imageDisposal))
  })
  assert.equal(removed.length, 3)
  assert.deepEqual(docker.state.images, [])
  assert.equal(docker.state.events.indexOf('save'), 0, 'candidates persisted before any removal')
  assert.ok(saved[0].candidates.length === 3 && !saved[0].verifiedAt)
  assert.ok(saved.at(-1).verifiedAt, 'verified absence is persisted')
  const removals = docker.state.calls.filter((call) => call.startsWith('image rm'))
  assert.deepEqual(
    removals.sort(),
    [hex(1), hex(2), hex(3)].map((id) => `image rm --no-prune ${id}`)
  )
  for (const call of docker.state.calls)
    assert.doesNotMatch(call, /prune(?!\s)|--force|\s-f\b|:latest/)
})

test('disposal is idempotent and never targets another stand or pulled images', async () => {
  const foreignStand = image(9, 'api')
  foreignStand.Config.Labels['org.amcore.stand'] = '55555555-5555-4555-8555-555555555555'
  const pulled = { Id: hex(8), Config: { Labels: {} }, RepoTags: ['postgres:18-alpine'] }
  const docker = fakeDocker({ images: [image(1), foreignStand, pulled] })
  assert.equal((await disposeImages(m, docker.execute, noSave)).length, 1)
  assert.deepEqual(await disposeImages(m, docker.execute, noSave), [])
  assert.deepEqual(
    docker.state.images.map((item) => item.Id),
    [hex(9), hex(8)]
  )
})

test('a foreign alias, a foreign sole tag or any referencing container refuses before mutation', async () => {
  const alias = fakeDocker({
    images: [image(1, 'api', { RepoTags: [`${m.project}-api:latest`, 'x:1'] })],
  })
  await assert.rejects(() => disposeImages(m, alias.execute, noSave), /Foreign image reference/)
  assert.equal(alias.state.images.length, 1)

  for (const container of [
    { Id: 'a'.repeat(64), Image: hex(1), Mounts: [] },
    { Id: 'b'.repeat(64), Image: hex(99), Mounts: [{ Type: 'image', Source: hex(1) }] },
  ]) {
    const used = fakeDocker({ images: [image(1)], containers: [container] })
    await assert.rejects(() => disposeImages(m, used.execute, noSave), /referenced by a container/)
    assert.equal(used.state.images.length, 1)
    assert.ok(!used.state.calls.some((call) => call.startsWith('image rm')))
  }
})

test('an engine conflict is a refusal, while an already-gone image is idempotent success', async () => {
  const docker = fakeDocker({ images: [image(1), image(2, 'web')] })
  const refusing = async (args, options) => {
    if (args[1] === 'rm' && args[3] === hex(1)) throw dockerError('conflict: must be forced')
    return docker.execute(args, options)
  }
  await assert.rejects(() => disposeImages(m, refusing, noSave), /Owned image removal refused/)

  const vanishing = fakeDocker({ images: [image(3), image(4, 'web')] })
  const retired = async (args, options) => {
    if (args[1] === 'inspect' && args.length === 3 && args[2] === hex(3)) {
      vanishing.state.images = vanishing.state.images.filter((item) => item.Id !== hex(3))
    }
    return vanishing.execute(args, options)
  }
  assert.equal((await disposeImages(m, retired, noSave)).length, 2)
  assert.deepEqual(vanishing.state.images, [])
})

test('exit success without verified absence is not success', async () => {
  const docker = fakeDocker({ images: [image(1)], keepAfterRemove: [hex(1)] })
  await assert.rejects(() => disposeImages(m, docker.execute, noSave), /could not be verified/)
})

test('closeout inventory lists every image labelled for the worktree', async () => {
  const docker = fakeDocker({
    images: [
      { ...image(1), Config: { Labels: { 'org.amcore.worktree': '/work/tree' } } },
      { ...image(2), Config: { Labels: { 'org.amcore.worktree': '/elsewhere' } } },
    ],
  })
  assert.deepEqual(await worktreeImages('/work/tree', docker.execute), [hex(1)])
  assert.deepEqual(await worktreeImages('/nowhere', docker.execute), [])
  assert.match(
    docker.state.calls[0],
    /^image ls -a --no-trunc -q --filter label=org\.amcore\.worktree=/
  )
})
