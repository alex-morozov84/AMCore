/**
 * ADR-034 guardrail — two complementary checks:
 *
 * 1. **Every HTTP handler under `apps/api/src/core/**` declares
 *    `@Auth(...)` explicitly** (handler- or class-level). This is the
 *    Stage 1a check that pre-dates the default flip and stays as
 *    defense in depth: a new core controller added without `@Auth`
 *    silently inherits the runtime default; making the declaration
 *    explicit keeps the matrix auditable.
 *
 * 2. **Every handler whose resolved auth-types contain
 *    `AuthType.ApiKey` matches an entry in the ADR-034 allowlist.**
 *    This is the Stage 1c inversion of the previous check: the
 *    runtime default flipped to `[AuthType.Bearer]`, so the only way
 *    a route accepts an API key is an explicit `@Auth(..., AuthType.ApiKey)`,
 *    and the only way that annotation is legitimate is matching the
 *    allowlist in ADR-034 §"Allowlist of routes that accept
 *    `AuthType.ApiKey` after Stage 1c".
 *
 * The allowlist below is the canonical machine-readable form of
 * ADR-034's table. Every new ApiKey-accepting surface requires both
 * an ADR amendment AND an entry here — the test failure message
 * tells the next agent exactly that.
 *
 * Entries use **route signatures**, not class/method names. This
 * survives controller-class or method renames (the URL is the actual
 * public contract).
 *
 * See ADR-034 in `ai/DECISIONS.md` and
 * `ai/ORGANIZATIONS_ADMIN_REVIEW.md` OA-11.
 */

// Loading each controller transitively pulls everything that controller
// depends on through Node's module graph. Two trees in this repo carry
// ESM-only dependencies that ts-jest's default `transformIgnorePatterns`
// doesn't process:
//   - EmailModule → React-Email templates → `@react-email/components`
//   - OAuth chain → `oauth-client.service` → `jose`
//
// The existing unit suite mocks them at the call site (e.g.
// `auth.controller.spec.ts:11`, `oauth.service.spec.ts:1-2`). We do
// the same here so the metadata-introspection test never instantiates
// the heavy services — we only read decorator metadata off the class.
jest.mock('../../../infrastructure/email', () => ({
  EmailService: jest.fn(),
}))
jest.mock('../oauth/oauth-client.service', () => ({
  OAuthClientService: jest.fn(),
}))
jest.mock('../oauth/providers/oauth-provider.factory', () => ({
  OAuthProviderFactory: jest.fn(),
}))

import { promises as fs } from 'node:fs'
import path from 'node:path'

import { RequestMethod } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'

import { AuthType } from '@amcore/shared'

import { AUTH_TYPE_KEY } from './auth.decorator'

const CORE_DIR = path.resolve(__dirname, '..', '..')

/**
 * ADR-034 allowlist of routes that may opt in to `AuthType.ApiKey`.
 *
 * Two entry shapes:
 *   - `{ kind: 'class', classPath, reason }` — every handler under the
 *     controller whose `@Controller(path)` argument matches `classPath`
 *     may accept API keys. Use when API-key acceptance is the
 *     controller-wide policy (current Stage 1c default for the org
 *     `userPerms ∩ scopes` surfaces).
 *   - `{ kind: 'handler', method, classPath, handlerPath, reason }` —
 *     only this specific route signature may accept API keys. Use for
 *     deliberate single-handler dual-auth surfaces (e.g. identity
 *     self-check).
 *
 * `method` uses `RequestMethod` (NestJS enum). `classPath` and
 * `handlerPath` are the literal strings passed to `@Controller(...)`
 * and the HTTP-verb decorator (`@Get('me')`, `@Post(':id/switch')`,
 * etc.); leading/trailing slashes are stripped before comparison.
 *
 * Stage 2 (`OA-03`) and Stage 4 (`OA-05`/`OA-06`) are expected to
 * narrow the class-level org entries below to handler-level entries.
 * Until then the class-level allowance reflects the current
 * `userPerms ∩ scopes` boundary inside each controller.
 */
interface ClassAllowlistEntry {
  kind: 'class'
  classPath: string
  reason: string
}

interface HandlerAllowlistEntry {
  kind: 'handler'
  method: RequestMethod
  classPath: string
  handlerPath: string
  reason: string
}

type AllowlistEntry = ClassAllowlistEntry | HandlerAllowlistEntry

const ADR_034_APIKEY_ALLOWLIST: readonly AllowlistEntry[] = [
  {
    kind: 'class',
    classPath: 'organizations',
    reason:
      'Org lifecycle/read surface — ApiKey access governed by ADR-033 (userPerms ∩ scopes). ' +
      'switchOrganization handler overrides to Bearer-only per OA-01. ' +
      'Transitional Stage 1c entry — Stage 2 (OA-03) may narrow per-handler.',
  },
  {
    kind: 'class',
    classPath: 'organizations/:orgId/members',
    reason:
      'Members management — ApiKey with manage:Organization scope per ADR-033. ' +
      'Per-handler @CheckPolicies remains the actual authorization gate. ' +
      'Transitional — Stage 4 (OA-05) may add role-ownership narrowings.',
  },
  {
    kind: 'class',
    classPath: 'organizations/:orgId/roles',
    reason:
      'Org role management — ApiKey with manage:Organization scope per ADR-033. ' +
      'Transitional — Stage 4 (OA-06) is expected to add assertOrgContext to listRoles ' +
      '(auth-types matrix unaffected; this entry stays after that change).',
  },
  {
    kind: 'handler',
    method: RequestMethod.GET,
    classPath: 'auth',
    handlerPath: 'me',
    reason:
      'Deliberate identity self-check surface for integrations per AK-01. ' +
      'Stable opt-in; no expected narrowing.',
  },
]

async function findControllerFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
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

function normalizePath(value: string | string[] | undefined): string {
  if (value === undefined) return ''
  // NestJS allows arrays of paths on a single decorator; pick the
  // first canonical form. None of our controllers use multi-path
  // decorators today, but the metadata API supports it.
  const raw = Array.isArray(value) ? (value[0] ?? '') : value
  return raw.replace(/^\/+|\/+$/g, '')
}

function matchesAllowlist(
  method: RequestMethod,
  classPath: string,
  handlerPath: string
): AllowlistEntry | undefined {
  return ADR_034_APIKEY_ALLOWLIST.find((entry) => {
    if (entry.kind === 'class') {
      return entry.classPath === classPath
    }
    return (
      entry.method === method && entry.classPath === classPath && entry.handlerPath === handlerPath
    )
  })
}

interface MissingExplicitAuth {
  controller: string
  method: string
  file: string
}

interface UnlistedApiKeyHandler {
  controller: string
  method: string
  file: string
  routeSignature: string
  resolvedAuthTypes: AuthType[]
}

describe('Core controllers — @Auth coverage and ADR-034 allowlist (OA-11 guardrail)', () => {
  it('every HTTP handler under apps/api/src/core/** declares explicit @Auth, and every ApiKey opt-in is in the ADR-034 allowlist', async () => {
    const files = await findControllerFiles(CORE_DIR)

    // Sanity: the project actually has controllers in core/**. If this
    // ever returns 0, the test would silently pass and the guardrail
    // would be a no-op.
    expect(files.length).toBeGreaterThan(0)

    const missingExplicit: MissingExplicitAuth[] = []
    const unlistedApiKey: UnlistedApiKeyHandler[] = []
    const inspectedControllers: string[] = []

    for (const file of files) {
      const mod: Record<string, unknown> = await import(file)
      for (const [exportName, exported] of Object.entries(mod)) {
        if (typeof exported !== 'function') continue
        // NestJS @Controller(...) writes PATH_METADATA on the class
        // itself. That's the most accurate way to identify a Nest
        // controller without booting the module.
        const rawClassPath = Reflect.getMetadata(PATH_METADATA, exported) as
          | string
          | string[]
          | undefined
        if (rawClassPath === undefined) continue
        const classPath = normalizePath(rawClassPath)

        inspectedControllers.push(exportName)

        const cls = exported as Function
        const proto = cls.prototype as Record<string, unknown> | undefined
        if (!proto) continue

        for (const methodName of Object.getOwnPropertyNames(proto)) {
          if (methodName === 'constructor') continue
          // Use the property descriptor so we don't accidentally
          // invoke prototype getters (e.g. `get cookieOptions()` on
          // `AuthController` would crash with `this.env === undefined`
          // when called on the bare prototype).
          const descriptor = Object.getOwnPropertyDescriptor(proto, methodName)
          if (!descriptor || typeof descriptor.value !== 'function') continue
          const handler = descriptor.value as Function

          // PATH_METADATA on a method is set by @Get/@Post/@Put/etc.
          // Helper methods without an HTTP verb decorator are skipped.
          const rawHandlerPath = Reflect.getMetadata(PATH_METADATA, handler) as
            | string
            | string[]
            | undefined
          if (rawHandlerPath === undefined) continue
          const handlerPath = normalizePath(rawHandlerPath)

          // Mirror `Reflector.getAllAndOverride` precedence: handler
          // metadata wins over class metadata. We call Reflect
          // directly to avoid the type plumbing — both lookups return
          // the same payload format the runtime guard reads.
          const handlerAuth = Reflect.getMetadata(AUTH_TYPE_KEY, handler) as AuthType[] | undefined
          const classAuth = Reflect.getMetadata(AUTH_TYPE_KEY, cls) as AuthType[] | undefined
          const resolvedAuthTypes = handlerAuth ?? classAuth

          if (resolvedAuthTypes === undefined) {
            missingExplicit.push({
              controller: exportName,
              method: methodName,
              file: path.relative(CORE_DIR, file),
            })
            continue
          }

          if (resolvedAuthTypes.includes(AuthType.ApiKey)) {
            const httpVerb = Reflect.getMetadata(METHOD_METADATA, handler) as
              | RequestMethod
              | undefined
            if (httpVerb === undefined) continue // no HTTP verb → not a routable handler
            const matched = matchesAllowlist(httpVerb, classPath, handlerPath)
            if (!matched) {
              const routeSignature = `${RequestMethod[httpVerb]} ${[classPath, handlerPath]
                .filter(Boolean)
                .join('/')}`
              unlistedApiKey.push({
                controller: exportName,
                method: methodName,
                file: path.relative(CORE_DIR, file),
                routeSignature,
                resolvedAuthTypes,
              })
            }
          }
        }
      }
    }

    // Sanity at the controller level — if we walked files but found
    // no controllers at all, the loop above did not actually exercise
    // anything. Keep the guardrail honest.
    expect(inspectedControllers.length).toBeGreaterThan(0)

    const errors: string[] = []

    if (missingExplicit.length > 0) {
      errors.push(
        `Found ${missingExplicit.length} HTTP handler(s) under apps/api/src/core/** without explicit @Auth(...):`,
        ...missingExplicit.map((v) => `  - ${v.controller}.${v.method}   (${v.file})`),
        '',
        'Every handler under core/** must declare @Auth(...) — either at the',
        'handler or at the controller-class level. The runtime default after',
        'ADR-034 is [AuthType.Bearer]; declaring @Auth explicitly keeps the',
        'auth-types matrix auditable and survives future default changes.',
        ''
      )
    }

    if (unlistedApiKey.length > 0) {
      errors.push(
        `Found ${unlistedApiKey.length} HTTP handler(s) opting in to AuthType.ApiKey without an ADR-034 allowlist entry:`,
        ...unlistedApiKey.map(
          (v) =>
            `  - ${v.routeSignature}   (${v.controller}.${v.method}, ${v.file})\n    resolved auth-types: ${v.resolvedAuthTypes.join(', ')}`
        ),
        '',
        'Per ADR-034 (Auth Default — Bearer-Only), API-key acceptance is an',
        'explicit allow-listed opt-in. To accept API keys on a new route:',
        '',
        '  1. Open an amendment to ADR-034 in ai/DECISIONS.md describing',
        '     the route and rationale (industry comparison, scope model,',
        '     whether it is transitional).',
        '  2. Add a matching entry to ADR_034_APIKEY_ALLOWLIST in this file.',
        '  3. Keep the @Auth(AuthType.Bearer, AuthType.ApiKey) annotation.',
        '',
        'If the route should NOT accept API keys, remove AuthType.ApiKey',
        'from the @Auth decorator (or drop the decorator to inherit the',
        'bearer-only default).',
        '',
        'See ADR-034 §"Allowlist of routes that accept `AuthType.ApiKey`',
        'after Stage 1c" and ai/ORGANIZATIONS_ADMIN_REVIEW.md OA-11.'
      )
    }

    if (errors.length > 0) {
      throw new Error(errors.join('\n'))
    }
  })
})
