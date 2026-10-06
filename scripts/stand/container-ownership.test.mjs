import { test } from 'node:test'
import assert from 'node:assert/strict'
import { labels } from './config.mjs'
import { owned } from './ownership.mjs'

const m = {
  uuid: '11111111-1111-4111-8111-111111111111',
  attempt: '22222222-2222-4222-8222-222222222222',
  worktree: '/work/tree',
  project: 'amcore-abcd1234-e2e-111111111111',
  snapshot: '/work/tree/.amcore/stands/s/source-new',
  approvedSnapshots: ['/work/tree/.amcore/stands/s/source-old'],
  services: ['postgres', 'redis', 'migrate', 'api', 'worker', 'web'],
}

// What `docker create` from a stand-built image inherits, with no override at all.
const inherited = {
  ...labels(m),
  'com.docker.compose.project': m.project,
  'com.docker.compose.service': 'web',
}
// What Compose adds on containers it creates (observed on a real stand).
const composeCreated = {
  ...inherited,
  'com.docker.compose.container-number': '1',
  'com.docker.compose.config-hash': 'abc',
  'com.docker.compose.oneoff': 'False',
  'com.docker.compose.project.working_dir': m.snapshot,
}

const container = (tags) => ({
  Name: '/unmanaged-review-container',
  Config: { Labels: tags },
  HostConfig: { NetworkMode: 'bridge' },
  Mounts: [],
})

test('a container created by this Compose allocation is proved', () => {
  assert.doesNotThrow(() => owned(m, container(composeCreated), 'container'))
})

test('a container from a stand image with only inherited labels is not proved', () => {
  assert.throws(
    () => owned(m, container(inherited), 'container'),
    /Container lacks Compose creation evidence/
  )
})

test('missing container number or a foreign working directory is not proved', () => {
  const noNumber = { ...composeCreated }
  delete noNumber['com.docker.compose.container-number']
  assert.throws(() => owned(m, container(noNumber), 'container'), /creation evidence/)
  const foreignDirectory = {
    ...composeCreated,
    'com.docker.compose.project.working_dir': '/somewhere/else',
  }
  assert.throws(() => owned(m, container(foreignDirectory), 'container'), /creation evidence/)
})

test('a container created from an earlier approved snapshot stays proved after refresh', () => {
  const earlier = {
    ...composeCreated,
    'com.docker.compose.project.working_dir': m.approvedSnapshots[0],
  }
  assert.doesNotThrow(() => owned(m, container(earlier), 'container'))
})

test('the tuple, project and service checks still apply before the creation evidence', () => {
  assert.throws(
    () => owned(m, container({ ...composeCreated, 'org.amcore.stand': 'other' }), 'container'),
    /Unproved container ownership/
  )
  assert.throws(
    () =>
      owned(
        m,
        container({ ...composeCreated, 'com.docker.compose.service': 'unknown' }),
        'container'
      ),
    /Foreign container service/
  )
})
