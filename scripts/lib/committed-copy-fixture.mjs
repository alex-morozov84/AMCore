// Test helpers: commit a throwaway repository and copy the real working tree into a committed
// fixture. Shared by tests that need a real Git history to run a script against.
import { git } from './test-fixture.mjs'
import { createWorkingTreeCopy } from './working-tree-fixture.mjs'

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

export function createCommittedCopy(copies) {
  const fixture = createWorkingTreeCopy()
  commit(fixture.root)
  copies.push(fixture)
  return fixture.root
}
