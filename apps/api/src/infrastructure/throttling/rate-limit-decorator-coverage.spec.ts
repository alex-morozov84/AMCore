/**
 * Starter-grade rate-limit guardrail — metadata-introspection regression
 * test, mirroring `auth-decorator-coverage.spec.ts`'s pattern.
 *
 * Scans every `*.controller.ts` under `apps/api/src/**` (not just
 * `core/**` — `health`/`observability` also ship controllers) and asserts:
 *
 * 1. Every controller in `MUST_SKIP_CONTROLLERS` actually carries a
 *    class-level `RATE_LIMIT_SKIP_KEY`. Deleting `@SkipRateLimit()` from
 *    `HealthController` must fail this test loudly, not silently pass
 *    because there's simply no metadata left to check.
 * 2. No class/handler carries both a skip and a policy override at once —
 *    a contradictory decoration that can only be a mistake.
 * 3. Every `@RateLimit(...)` policy found has a sane shape (`rate > 0`,
 *    `per > 0`) — catches an obvious typo (e.g. `{ rate: 0, ... }`) that
 *    would otherwise silently refuse every request to that route.
 *
 * Unlike PR A's version of this test, there is no "unregistered throttler
 * name"/"partial skip" check and no metadata-key-prefix canary: those
 * existed only because `@nestjs/throttler`'s named-throttler model and
 * unexported internal constants created that risk. Option O (ADR-073)
 * removed the dependency entirely — `RATE_LIMIT_POLICY_KEY`/
 * `RATE_LIMIT_SKIP_KEY` are AMCore's own literal constants, not a
 * third-party's internal implementation detail to guard against drifting.
 */

jest.mock('../email', () => ({
  EmailService: jest.fn(),
}))
jest.mock('../../core/auth/oauth/oauth-client.service', () => ({
  OAuthClientService: jest.fn(),
}))
jest.mock('../../core/auth/oauth/providers/oauth-provider.factory', () => ({
  OAuthProviderFactory: jest.fn(),
}))

import { promises as fs } from 'node:fs'
import path from 'node:path'

import { PATH_METADATA } from '@nestjs/common/constants'

import { RATE_LIMIT_POLICY_KEY, RATE_LIMIT_SKIP_KEY } from './rate-limit.decorator'
import type { RateLimitPolicy } from './rate-limit-policies'

const SRC_DIR = path.resolve(__dirname, '..', '..')

/**
 * Controllers that must stay fully unthrottled — a class-level skip.
 * Exported class names, not file paths, since that's what the walk below
 * keys findings on.
 */
const MUST_SKIP_CONTROLLERS = ['HealthController', 'MetricsController']

async function findControllerFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === 'generated') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await findControllerFiles(full)))
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.controller.ts') &&
      !entry.name.endsWith('.spec.ts')
    ) {
      out.push(full)
    }
  }
  return out
}

interface ContradictionFinding {
  controller: string
  member: string
  file: string
}

interface InvalidPolicyFinding {
  controller: string
  member: string
  file: string
  policy: RateLimitPolicy
}

describe('Controllers — rate-limit decorator coverage (starter-grade guardrail)', () => {
  it('MUST_SKIP_CONTROLLERS stay fully skipped, no contradictory decoration, every policy shape is sane', async () => {
    const files = await findControllerFiles(SRC_DIR)
    expect(files.length).toBeGreaterThan(0)

    const inspectedControllers: string[] = []
    const classSkipped = new Set<string>()
    const contradictions: ContradictionFinding[] = []
    const invalidPolicies: InvalidPolicyFinding[] = []

    const checkTarget = (
      target: object,
      controller: string,
      member: string,
      file: string
    ): void => {
      const skip = Reflect.getMetadata(RATE_LIMIT_SKIP_KEY, target) as boolean | undefined
      const policy = Reflect.getMetadata(RATE_LIMIT_POLICY_KEY, target) as
        RateLimitPolicy | undefined

      if (skip && policy) {
        contradictions.push({ controller, member, file })
      }
      if (policy && (policy.rate <= 0 || policy.per <= 0)) {
        invalidPolicies.push({ controller, member, file, policy })
      }
    }

    for (const file of files) {
      const mod: Record<string, unknown> = await import(file)
      for (const [exportName, exported] of Object.entries(mod)) {
        if (typeof exported !== 'function') continue
        const rawClassPath = Reflect.getMetadata(PATH_METADATA, exported) as
          string | string[] | undefined
        if (rawClassPath === undefined) continue // not a @Controller

        inspectedControllers.push(exportName)
        const cls = exported as Function
        const relFile = path.relative(SRC_DIR, file)

        checkTarget(cls, exportName, '(class)', relFile)
        if (Reflect.getMetadata(RATE_LIMIT_SKIP_KEY, cls) === true) {
          classSkipped.add(exportName)
        }

        const proto = cls.prototype as Record<string, unknown> | undefined
        if (!proto) continue
        for (const methodName of Object.getOwnPropertyNames(proto)) {
          if (methodName === 'constructor') continue
          const descriptor = Object.getOwnPropertyDescriptor(proto, methodName)
          if (!descriptor || typeof descriptor.value !== 'function') continue
          checkTarget(descriptor.value as Function, exportName, methodName, relFile)
        }
      }
    }

    expect(inspectedControllers.length).toBeGreaterThan(0)

    const missingMustSkip = MUST_SKIP_CONTROLLERS.filter((name) => !classSkipped.has(name))

    const errors: string[] = []

    if (missingMustSkip.length > 0) {
      errors.push(
        `${missingMustSkip.length} controller(s) in MUST_SKIP_CONTROLLERS no longer carry a class-level @SkipRateLimit():`,
        ...missingMustSkip.map(
          (name) =>
            `  - ${name}   (${inspectedControllers.includes(name) ? 'found, but not skipped' : 'not found among inspected controllers — was it renamed or moved?'})`
        ),
        '',
        'These controllers must stay fully unthrottled. Add (or restore)',
        '@SkipRateLimit() at the class level.'
      )
    }

    if (contradictions.length > 0) {
      errors.push(
        `Found ${contradictions.length} class/handler with both @SkipRateLimit() and @RateLimit(...):`,
        ...contradictions.map((v) => `  - ${v.controller}.${v.member}   (${v.file})`),
        '',
        'A route cannot be both skipped and policy-limited — remove one.'
      )
    }

    if (invalidPolicies.length > 0) {
      errors.push(
        `Found ${invalidPolicies.length} @RateLimit(...) policy with a non-positive rate/per:`,
        ...invalidPolicies.map(
          (v) =>
            `  - ${v.controller}.${v.member}   (${v.file})   policy=${JSON.stringify(v.policy)}`
        ),
        '',
        'rate and per must both be > 0 — a non-positive value would refuse',
        'every request to this route.'
      )
    }

    if (errors.length > 0) {
      throw new Error(errors.join('\n'))
    }
  })
})
