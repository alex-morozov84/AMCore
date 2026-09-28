import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanEnvironment } from './process.mjs'
import { admitSource } from './snapshot.mjs'
import { owned } from './ownership.mjs'
import { relayTarget } from './relay.mjs'

test('poisoned inherited environment never controls generated child targeting', () => {
  const poisoned = {
    PATH: '/bin',
    HOME: '/home/test',
    DATABASE_URL: 'postgresql://foreign.invalid/x',
    E2E_DATABASE_URL: 'postgresql://foreign.invalid/y',
    COMPOSE_FILE: '/foreign.yml',
    MIGRATION_DATABASE_URL: 'postgresql://foreign.invalid/z',
    REDIS_URL: 'redis://foreign.invalid',
    DOCKER_HOST: 'ssh://foreign.invalid',
    NODE_OPTIONS: '--import=foreign',
    HTTPS_PROXY: 'http://foreign.invalid',
  }
  assert.deepEqual(cleanEnvironment({}, poisoned), {
    PATH: '/bin',
    HOME: '/home/test',
    NEXT_TELEMETRY_DISABLED: '1',
    HUSKY: '0',
    COMPOSE_PROGRESS: 'plain',
    BUILDKIT_PROGRESS: 'plain',
  })
})
test('snapshot excludes secrets/runtime even if tracked', () => {
  for (const path of [
    '.env',
    '.env.production',
    'apps/web/.env.test',
    '.worktrees/a/x',
    '.amcore/source/x',
    'ai/private-input.txt',
    'apps/web/.next/a',
    'tls/root.key',
  ])
    assert.equal(admitSource(path), false, path)
  for (const path of [
    '.env.example',
    'apps/web/src/app/page.tsx',
    'scripts/stand.mjs',
    'apps/api/src/core/ai/ai.module.ts',
    'docs/ai/README.md',
  ])
    assert.equal(admitSource(path), true, path)
})
test('marker is not required to prove partial resource ownership', () => {
  const m = { uuid: 'uuid', attempt: 'attempt', worktree: '/repo', project: 'project' }
  const resource = {
    Name: 'project_data',
    Labels: {
      'org.amcore.stand': 'uuid',
      'org.amcore.attempt': 'attempt',
      'org.amcore.worktree': '/repo',
      'com.docker.compose.project': 'project',
    },
  }
  assert.doesNotThrow(() => owned(m, resource, 'volume'))
  assert.throws(() =>
    owned(m, { Labels: { ...resource.Labels, 'org.amcore.attempt': 'other' } }, 'volume')
  )
  assert.throws(() =>
    owned(m, { Labels: { ...resource.Labels, 'com.docker.compose.project': 'foreign' } }, 'volume')
  )
})
test('relay admits exact origin only; query cannot change transport or port', () => {
  const origins = ['https://app-task.localhost:24567']
  assert.equal(relayTarget(origins, origins[0] + '/en?x=1').hostname, 'app-task.localhost')
  for (const value of [
    'http://app-task.localhost:24567',
    'https://app-task.localhost:24568',
    'https://foreign.localhost:24567',
    'https://127.0.0.1:24567',
    'https://user@app-task.localhost:24567',
    'https://app-task.localhost:24567#fragment',
  ])
    assert.throws(() => relayTarget(origins, value))
})
