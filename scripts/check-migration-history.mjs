// PR merge checkout: preserve every migration already present on its first parent.
import { execFileSync } from 'node:child_process'

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

function migrationEntries(ref) {
  const entries = git('ls-tree', '-r', '-z', `${ref}^{tree}`, '--', 'apps/api/prisma/migrations')
  return new Map(
    entries
      .split('\0')
      .filter((entry) => entry.endsWith('/migration.sql'))
      .map((entry) => {
        const separator = entry.indexOf('\t')
        return [entry.slice(separator + 1), entry.slice(0, separator)]
      })
  )
}

function checkHistory() {
  if (process.argv.length !== 2 || process.env.GITHUB_EVENT_NAME !== 'pull_request') {
    throw new Error('Run without arguments on a pull_request synthetic merge checkout')
  }
  const head = git('rev-parse', '--verify', 'HEAD').trim()
  if (head !== process.env.GITHUB_SHA) throw new Error('HEAD differs from GITHUB_SHA')
  const parents = git('rev-list', '--parents', '-n', '1', 'HEAD').trim().split(' ').slice(1)
  if (parents.length !== 2)
    throw new Error('Expected two merge parents; checkout with fetch-depth: 2')
  const baseline = migrationEntries(parents[0]) // Missing parent/tree is a hard failure.
  const candidate = migrationEntries(head)
  const changed = [...baseline].filter(([path, blob]) => candidate.get(path) !== blob)
  if (changed.length) {
    throw new Error(
      `Shared migrations changed or disappeared:\n${changed.map(([path]) => path).join('\n')}`
    )
  }
  console.log(`Migration history preserved: ${baseline.size} existing SQL files checked`)
}

try {
  checkHistory()
} catch (error) {
  console.error(`migration-history: ${error.message}`)
  process.exitCode = 1
}
