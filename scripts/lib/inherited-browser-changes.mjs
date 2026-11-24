import { execFileSync } from 'node:child_process'

function git(root, ...args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function objectAt(root, commit, file) {
  try {
    return git(root, 'rev-parse', '--verify', `${commit}:${file}`)
  } catch {
    return null
  }
}

function incomingCommit(root, base, head) {
  const [first, incoming, extra] = git(root, 'show', '-s', '--format=%P', head).split(' ')
  return first === base && !extra ? incoming : undefined
}

function upstreamRole(root, commit) {
  try {
    return git(root, 'show', `${commit}:PROJECT_CONTEXT.md`)
      .split('\n')
      .includes('- **Mode:** `upstream-starter`')
  } catch {
    return false
  }
}

function sourceMerges(root, base, head) {
  const merges = git(root, 'rev-list', '--first-parent', '--merges', `${base}..${head}`)
  return merges
    .split('\n')
    .filter(Boolean)
    .map((merge) => incomingCommit(root, base, merge))
    .filter(Boolean)
}

/** Compare only an existing untouched product file brought in by a source merge. */
export function inheritedBrowserChanges(root, { base, head, checkout }, files) {
  const specs = files.filter((file) => /^apps\/web\/e2e\/.+\.spec\.ts$/.test(file))
  if (!base || !specs.length) return []
  const merges = sourceMerges(root, base, head)
  const sources = merges.flatMap((incoming) =>
    upstreamRole(root, incoming) ? [incoming] : sourceMerges(root, base, incoming)
  )
  const comparison = sources.flatMap((incoming) => {
    if (!upstreamRole(root, incoming)) return []
    const ancestor = git(root, 'merge-base', base, incoming)
    return upstreamRole(root, ancestor) ? [{ ancestor, incoming }] : []
  })
  return specs.filter((file) =>
    comparison.some(({ ancestor, incoming }) => {
      const original = objectAt(root, ancestor, file)
      if (!original || original !== objectAt(root, base, file)) return false
      const inherited = objectAt(root, incoming, file)
      return inherited && inherited === objectAt(root, checkout, file)
    })
  )
}
