import { spawnSync } from 'node:child_process'

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'buffer' })
  if (result.error || result.status !== 0) {
    throw new Error(result.stderr?.toString().trim() || result.error?.message || 'git failed')
  }
  return result.stdout
}

function statusEntries(root) {
  const data = git(root, ['diff', '--cached', '--name-status', '-z', '-M', '--diff-filter=ACMR'])
    .toString('utf8')
    .split('\0')
  const entries = []
  for (let index = 0; index < data.length - 1;) {
    const status = data[index++]
    if (status.startsWith('R') || status.startsWith('C')) {
      index++
      const path = data[index++]
      if (status !== 'R100') entries.push({ status, path })
    } else {
      entries.push({ status, path: data[index++] })
    }
  }
  return entries
}

function changedLines(root, path) {
  const diff = git(root, [
    'diff',
    '--cached',
    '--unified=0',
    '--no-ext-diff',
    '--no-color',
    '--',
    path,
  ]).toString('utf8')
  const ranges = []
  for (const match of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gmu)) {
    const start = Number(match[1])
    const count = match[2] === undefined ? 1 : Number(match[2])
    ranges.push([Math.max(1, start), Math.max(1, start + count - 1)])
  }
  return ranges
}

export function stagedFiles(root) {
  return statusEntries(root).map(({ status, path }) => ({
    path,
    added: status === 'A',
    source: git(root, ['show', `:${path}`]).toString('utf8'),
    ranges: changedLines(root, path),
  }))
}
