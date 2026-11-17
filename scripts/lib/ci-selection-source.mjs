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
  let diffComplete = false
  let integration = false
  try {
    if (base && git('rev-parse', '--is-shallow-repository') === 'false') {
      git('merge-base', '--is-ancestor', base, head)
      integration = Boolean(git('rev-list', '--merges', `${base}..${head}`))
      diffComplete = ['pull_request', 'push'].includes(event)
    }
  } catch {
    /* Missing/disconnected history requires broad diagnostics. No fetch here. */
  }
  return { source: { head, base }, diffComplete, integration }
}
