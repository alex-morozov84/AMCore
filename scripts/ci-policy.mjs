import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { parseCiRole, resolveCiPolicy } from './lib/ci-policy.mjs'
import { readCiPolicySources } from './lib/ci-policy-source.mjs'

try {
  const root = process.cwd()
  const event = process.env.GITHUB_EVENT_NAME
  const repository = process.env.GITHUB_REPOSITORY
  if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw new Error('CI policy requires the repository identity from GitHub context')
  const payload = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new Error('CI policy requires a GitHub event object')
  const head = event === 'pull_request' ? payload.pull_request?.head?.sha : process.env.GITHUB_SHA
  const base = event === 'pull_request' ? payload.pull_request?.base?.sha : undefined
  const requested = payload.inputs?.['full-once']
  if (requested !== undefined && ![true, false, 'true', 'false'].includes(requested))
    throw new Error('full-once must be an explicit boolean workflow input')
  const sources = readCiPolicySources({ root, event, base, head })
  // Source reads above admit exact commits before either SHA enters a Git argument.
  const role = parseCiRole(
    execFileSync('git', ['show', `${head}:PROJECT_CONTEXT.md`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  )
  const policy = resolveCiPolicy({
    role,
    repository,
    event,
    ...sources,
    fullOnce: requested === true || requested === 'true',
  })
  console.log(
    JSON.stringify({ repository, event, role, source: { head, base: base ?? null }, ...policy })
  )
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
