// Shared test-harness helpers for init-project.test.mjs and
// init-project-storybook.test.mjs — split out once a second e2e test file
// needed the same "commit a real-repo copy, then invoke the real CLI"
// shape, to avoid duplicating it.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { git } from './test-fixture.mjs'

export const INIT_PROJECT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'init-project.mjs'
)

export function commit(root) {
  git(root, ['init', '--quiet', '--initial-branch=main'])
  git(root, ['add', '-A'])
  git(root, [
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@example.com',
    'commit',
    '-m',
    'fixture',
    '--quiet',
  ])
}

export function runInitProject(root, args, { skipVerify = true } = {}) {
  return spawnSync('node', [INIT_PROJECT, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      AMCORE_INIT_ROOT: root,
      ...(skipVerify ? { AMCORE_INIT_SKIP_VERIFY: '1' } : {}),
    },
  })
}
