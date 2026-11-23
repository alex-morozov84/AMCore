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
  const fullOnce = requested === true || requested === 'true'
  const expectedSha = payload.inputs?.['source-sha']
  if (fullOnce && (!/^[a-f0-9]{40}$/.test(expectedSha ?? '') || expectedSha !== head))
    throw new Error('Full-once requires source-sha matching the checked-out commit')
  const sources = readCiPolicySources({ root, event, base, head })
  // Source reads above admit exact commits before either SHA enters a Git argument.
  const roleAt = (sha) =>
    parseCiRole(
      execFileSync('git', ['show', `${sha}:PROJECT_CONTEXT.md`], { cwd: root, encoding: 'utf8' })
    )
  const role = roleAt(head)
  if (base && role !== roleAt(base))
    throw new Error('CI repository role cannot change in an ordinary PR')
  const policy = resolveCiPolicy({
    role,
    repository,
    event,
    ...sources,
    fullOnce,
  })
  console.log(
    JSON.stringify({ repository, event, role, source: { head, base: base ?? null }, ...policy })
  )
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
