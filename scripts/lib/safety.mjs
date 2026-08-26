// Apply-mode-only guards (ADR-071). --dry-run never calls these — it never
// writes, so it's always safe to run anywhere, including the AMCore
// maintainer checkout itself.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export class SafetyError extends Error {}

export const MAINTAINER_OVERRIDE_TOKEN = 'i-understand-this-is-amcore-maintainer-checkout'

export function assertCleanGitTree(cwd) {
  const out = execFileSync('git', ['status', '--porcelain'], {
    cwd,
    encoding: 'utf8',
    timeout: 10_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (out.trim() !== '') {
    throw new SafetyError('working tree is not clean — commit or stash before applying')
  }
}

/**
 * Refuses to apply if `ai/` is present (a strong signal this is the AMCore
 * maintainer checkout, not a downstream fork) unless the caller passed the
 * exact override token. The token is deliberately not documented in
 * `--help` — see ai/PROCESS.md.
 */
export function assertNotMaintainerCheckout(cwd, forceToken) {
  if (!existsSync(join(cwd, 'ai'))) return
  if (forceToken === MAINTAINER_OVERRIDE_TOKEN) return
  throw new SafetyError(
    'refusing to apply: an ai/ directory is present, which strongly suggests this is the ' +
      'AMCore maintainer checkout, not a downstream fork. See ai/PROCESS.md if you are ' +
      'certain this is intentional.'
  )
}
