// Shared test-harness helpers for init-project.test.mjs and
// init-project-storybook.test.mjs — split out once a second e2e test file
// needed the same "commit a real-repo copy, then invoke the real CLI"
// shape, to avoid duplicating it.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRealRepoCopy, git } from './test-fixture.mjs'

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

export function createCommittedCopy(copies) {
  const fixture = createRealRepoCopy()
  commit(fixture.root)
  copies.push(fixture)
  return fixture.root
}

export function applyProject(root, args) {
  const result = runInitProject(root, [...args, '--yes'])
  if (result.status !== 0) throw new Error(result.stderr)
}

export function verifyProjectSteps(root, steps) {
  for (const args of steps) {
    const result = spawnSync('pnpm', args, { cwd: root, encoding: 'utf8', env: { ...process.env } })
    if (result.status !== 0)
      throw new Error(`pnpm ${args.join(' ')}: ${result.stdout}${result.stderr}`)
  }
}
