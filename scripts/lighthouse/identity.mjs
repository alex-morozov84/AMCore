import { invariant } from '../lib/lighthouse-plan.mjs'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

export function runIdentity(root, env = process.env) {
  const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  invariant(!env.GITHUB_SHA || env.GITHUB_SHA === source, 'checkout-sha-mismatch')
  return {
    run: env.GITHUB_RUN_ID ?? `local-${randomUUID()}`,
    attempt: env.GITHUB_RUN_ATTEMPT ?? '1',
    source: source,
  }
}
