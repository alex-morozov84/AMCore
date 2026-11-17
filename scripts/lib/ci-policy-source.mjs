import { execFileSync } from 'node:child_process'

/** Read only committed policy: a missing file is normal, a missing commit is not. */
export function readCiPolicyAt(root, sha) {
  if (typeof sha !== 'string' || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(sha))
    throw new Error('CI policy requires an exact source commit')
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  if (git('cat-file', '-t', sha) !== 'commit') throw new Error('CI source must be a commit')
  const path = 'ci/product.json'
  if (!git('ls-tree', '--name-only', sha, '--', path)) return null
  return git('show', `${sha}:${path}`)
}

export function readCiPolicySources({ root, event, base, head }) {
  return {
    base: event === 'pull_request' ? readCiPolicyAt(root, base) : null,
    head: readCiPolicyAt(root, head),
  }
}
