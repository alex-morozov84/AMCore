const modes = ['normal', 'full', 'heavy-off']
const roles = ['upstream-starter', 'downstream-product']

export function parseCiPolicy(source) {
  if (source === null) return { version: 1, mode: 'normal' }
  const policy = JSON.parse(source)
  if (
    !policy ||
    typeof policy !== 'object' ||
    Array.isArray(policy) ||
    Object.keys(policy).length !== 2 ||
    policy.version !== 1 ||
    !Object.hasOwn(policy, 'mode') ||
    !modes.includes(policy.mode)
  )
    throw new Error('Invalid CI policy: expected version 1 and mode normal/full/heavy-off')
  return policy
}

export function parseCiRole(context) {
  const lines = context.split('\n').filter((line) => /^- \*\*Mode:\*\*/.test(line))
  const match =
    lines.length === 1 && /^- \*\*Mode:\*\* `(upstream-starter|downstream-product)`$/.exec(lines[0])
  if (!match) throw new Error('PROJECT_CONTEXT must declare exactly one canonical Mode')
  return match[1]
}

/** PRs use the base choice but must validate the proposed choice even when it is not yet active. */
export function resolveCiPolicy({ role, repository, event, base, head, fullOnce = false }) {
  if (!roles.includes(role)) throw new Error('Unknown CI repository role')
  if (!['pull_request', 'push', 'workflow_dispatch', 'schedule', 'release'].includes(event))
    throw new Error('Unsupported CI event')
  if (typeof fullOnce !== 'boolean' || (fullOnce && event !== 'workflow_dispatch'))
    throw new Error('Full-once is an explicit workflow_dispatch choice only')
  const proposed = parseCiPolicy(head)
  const active = event === 'pull_request' ? parseCiPolicy(base) : proposed
  if (repository === 'alex-morozov84/AMCore' && role !== 'upstream-starter')
    throw new Error('Canonical AMCore must keep the upstream-starter role')
  if (role === 'upstream-starter' && [active.mode, proposed.mode].includes('heavy-off'))
    throw new Error('AMCore starter checks cannot use heavy-off')
  return {
    mode: fullOnce ? 'full' : active.mode,
    saved: active.mode,
    proposed: proposed.mode,
    fullOnce,
  }
}
