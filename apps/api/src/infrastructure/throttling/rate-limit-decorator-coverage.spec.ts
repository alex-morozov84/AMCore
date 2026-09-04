/**
 * Starter-grade rate-limit guardrail — metadata-introspection regression
 * test, mirroring `auth-decorator-coverage.spec.ts`'s pattern.
 *
 * Scans every `*.controller.ts` under `apps/api/src/**` (not just
 * `core/**` — `health`/`observability` also ship controllers) and asserts:
 *
 * 1. No class or handler carries `@nestjs/throttler` limit/skip metadata
 *    for a throttler name that isn't registered in `THROTTLER_NAMES`. This
 *    catches a typo'd override or a future bare `@SkipThrottle()`/
 *    `@Throttle({...})` reaching a controller outside this directory (the
 *    eslint `no-restricted-imports` ban is the first line of defense; this
 *    is the second, since it inspects the actual decorator output rather
 *    than the import statement).
 * 2. Any class/handler that skips at least one registered throttler skips
 *    **all** of them — a partial skip (e.g. only `short`) would silently
 *    leave the route bucketed against the other, which is never the
 *    intent of `@SkipRateLimit()`.
 * 3. Every controller in `MUST_SKIP_CONTROLLERS` actually carries a
 *    class-level skip covering every registered throttler. (1) and (2)
 *    alone only check *consistency* of whatever metadata happens to be
 *    present — if `@SkipRateLimit()` were deleted from `HealthController`
 *    entirely, there would be no metadata at all to find inconsistent,
 *    and the test would stay green. This assertion pins the actual
 *    regression this guardrail exists for: the health/metrics probes
 *    must stay unthrottled, not just "consistently" throttled.
 *
 * A companion `it()` below asserts the hardcoded metadata-key prefixes
 * (next paragraph) still match what a real `@Throttle`/`@SkipThrottle`
 * call produces today, so a future `@nestjs/throttler` version that
 * changes its internal constant format fails loudly here instead of
 * silently disabling every check above.
 *
 * `@nestjs/throttler`'s `THROTTLER_LIMIT`/`THROTTLER_SKIP` metadata-key
 * constants are not re-exported from the package's public `index`
 * (confirmed against the installed `dist/index.d.ts`), so the literal
 * prefixes are hardcoded here — the same constraint `admin.e2e-spec.ts`
 * documents for its own throttler-metadata assertions.
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
import { SkipThrottle, Throttle } from '@nestjs/throttler'

import { THROTTLER_NAMES } from './rate-limit-policies'

const SRC_DIR = path.resolve(__dirname, '..', '..')
const THROTTLER_LIMIT_PREFIX = 'THROTTLER:LIMIT'
const THROTTLER_SKIP_PREFIX = 'THROTTLER:SKIP'

/**
 * Controllers that must stay fully unthrottled — a class-level skip
 * covering every registered throttler. Exported class names, not file
 * paths, since that's what the walk below keys findings on.
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

/** Every registered-or-not throttler name referenced by LIMIT/SKIP metadata on `target`. */
function throttlerNamesOnTarget(target: object): { limited: Set<string>; skipped: Set<string> } {
  const limited = new Set<string>()
  const skipped = new Set<string>()
  for (const key of Reflect.getMetadataKeys(target) as string[]) {
    if (key.startsWith(THROTTLER_LIMIT_PREFIX)) {
      limited.add(key.slice(THROTTLER_LIMIT_PREFIX.length))
    } else if (key.startsWith(THROTTLER_SKIP_PREFIX)) {
      skipped.add(key.slice(THROTTLER_SKIP_PREFIX.length))
    }
  }
  return { limited, skipped }
}

interface UnregisteredNameFinding {
  controller: string
  member: string
  file: string
  kind: 'limit' | 'skip'
  name: string
}

interface PartialSkipFinding {
  controller: string
  member: string
  file: string
  skipped: string[]
}

describe('Controllers — rate-limit decorator coverage (starter-grade guardrail)', () => {
  it('every @nestjs/throttler override targets a registered throttler name, and skips are all-or-nothing', async () => {
    const files = await findControllerFiles(SRC_DIR)
    expect(files.length).toBeGreaterThan(0)

    const unregistered: UnregisteredNameFinding[] = []
    const partialSkips: PartialSkipFinding[] = []
    const inspectedControllers: string[] = []
    const classSkipCoverage = new Map<string, number>()

    const registeredNames = new Set<string>(THROTTLER_NAMES)

    const checkTarget = (
      target: object,
      controller: string,
      member: string,
      file: string
    ): void => {
      const { limited, skipped } = throttlerNamesOnTarget(target)
      for (const name of limited) {
        if (!registeredNames.has(name)) {
          unregistered.push({ controller, member, file, kind: 'limit', name })
        }
      }
      for (const name of skipped) {
        if (!registeredNames.has(name)) {
          unregistered.push({ controller, member, file, kind: 'skip', name })
        }
      }
      if (skipped.size > 0 && skipped.size !== registeredNames.size) {
        partialSkips.push({ controller, member, file, skipped: [...skipped].sort() })
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
        classSkipCoverage.set(exportName, throttlerNamesOnTarget(cls).skipped.size)

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

    const missingMustSkip = MUST_SKIP_CONTROLLERS.filter(
      (name) => (classSkipCoverage.get(name) ?? 0) !== registeredNames.size
    )

    const errors: string[] = []

    if (missingMustSkip.length > 0) {
      errors.push(
        `${missingMustSkip.length} controller(s) in MUST_SKIP_CONTROLLERS no longer carry a full class-level @SkipRateLimit():`,
        ...missingMustSkip.map((name) => {
          const found = classSkipCoverage.has(name)
          return `  - ${name}   (${found ? `skips ${classSkipCoverage.get(name)}/${registeredNames.size} registered throttlers` : 'not found among inspected controllers — was it renamed or moved?'})`
        }),
        '',
        'These controllers must stay fully unthrottled. Add (or restore)',
        '@SkipRateLimit() at the class level.'
      )
    }

    if (unregistered.length > 0) {
      errors.push(
        `Found ${unregistered.length} throttler override(s) targeting an unregistered name:`,
        ...unregistered.map(
          (v) =>
            `  - ${v.controller}.${v.member}   (${v.file})   ${v.kind}="${v.name}" — registered names: ${[...registeredNames].join(', ')}`
        ),
        '',
        'Every @RateLimit(...)/@SkipRateLimit() call maps onto THROTTLER_NAMES',
        '(rate-limit-policies.ts). An unregistered name is either a typo or a',
        'raw @Throttle/@SkipThrottle call outside infrastructure/throttling/**',
        '(which eslint should already have caught) — a throttler override for',
        'a name nothing registers is silently a no-op.'
      )
    }

    if (partialSkips.length > 0) {
      errors.push(
        `Found ${partialSkips.length} partial skip(s) — some registered throttlers skipped, others not:`,
        ...partialSkips.map(
          (v) =>
            `  - ${v.controller}.${v.member}   (${v.file})   skips: ${v.skipped.join(', ')} — registered: ${[...registeredNames].join(', ')}`
        ),
        '',
        'Use @SkipRateLimit() (infrastructure/throttling), which skips every',
        'registered throttler. A partial skip leaves the route bucketed',
        'against the throttler(s) not listed — almost never the intent.'
      )
    }

    if (errors.length > 0) {
      throw new Error(errors.join('\n'))
    }
  })

  it('THROTTLER_LIMIT_PREFIX/THROTTLER_SKIP_PREFIX still match real @nestjs/throttler output', () => {
    class Canary {}
    Throttle({ long: { limit: 1, ttl: 1000 } })(Canary)
    SkipThrottle({ short: true })(Canary)

    const keys = Reflect.getMetadataKeys(Canary) as string[]
    expect(keys.some((k) => k.startsWith(THROTTLER_LIMIT_PREFIX) && k.endsWith('long'))).toBe(true)
    expect(keys.some((k) => k.startsWith(THROTTLER_SKIP_PREFIX) && k.endsWith('short'))).toBe(true)
  })
})
