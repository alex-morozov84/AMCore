import { execFileSync } from 'node:child_process'

/** Admit event identities; unavailable ancestry widens diagnostics, never authorizes exclusions. */
export function readSelectionSource(root, event, payload, sha) {
  if (!['pull_request', 'push', 'schedule', 'release', 'workflow_dispatch'].includes(event))
    throw new Error('Unsupported selection event')
  const head = event === 'pull_request' ? payload.pull_request?.head?.sha : sha
  const before = event === 'pull_request' ? payload.pull_request?.base?.sha : payload.before
  const exact = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)
  if (!exact(head) || (event === 'pull_request' && !exact(before)))
    throw new Error('Selection requires exact event source commits')
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  if (git('cat-file', '-t', head) !== 'commit') throw new Error('Head is not a commit')
  const base = exact(before) && !/^0+$/.test(before) ? before : null
  const checkout = git('rev-parse', 'HEAD')
  if (!exact(sha) || checkout !== sha) throw new Error('CI checkout does not match event SHA')
  if (event === 'pull_request' && git('show', '-s', '--format=%P', checkout) !== `${base} ${head}`)
    throw new Error('PR merge checkout does not match the event')
  const baseExists =
    base &&
    (() => {
      try {
        return git('cat-file', '-t', base) === 'commit'
      } catch {
        return false
      }
    })()
  let diffComplete =
    Boolean(baseExists) &&
    ['pull_request', 'push'].includes(event) &&
    git('rev-parse', '--is-shallow-repository') === 'false'
  if (diffComplete && event === 'push') {
    try {
      git('merge-base', '--is-ancestor', base, checkout)
    } catch {
      diffComplete = false
    }
  }
  const integration = diffComplete && Boolean(git('rev-list', '--merges', `${base}..${head}`))
  const changedFiles = diffComplete
    ? execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', base, checkout], {
        cwd: root,
        encoding: 'utf8',
      })
        .split('\0')
        .filter(Boolean)
        .sort()
    : []
  return {
    source: { head, base, checkout },
    diffComplete,
    integration,
    changedFiles,
    baseExists: Boolean(baseExists),
  }
}
