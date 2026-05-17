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
 *    `AuthType.ApiKey` matches an exact route-signature entry in the
 *    ADR-034 allowlist.** The runtime default after Stage 1c is
 *    `[AuthType.Bearer]`, so ApiKey acceptance reaches a handler only
 *    through an explicit `@Auth(..., AuthType.ApiKey)` (handler- or
 *    class-level). This check then asserts that every such opt-in is
 *    enumerated by route signature — class-wide entries would
 *    silently bless any new handler added to an annotated class,
 *    contradicting the ADR-034 amendment process.
 *
 * The allowlist below is the canonical machine-readable form of
 * ADR-034's enumerated allowlist. Every new ApiKey-accepting surface
 * requires both an ADR amendment AND a per-handler entry here — the
 * test failure message tells the next agent exactly that.
 *
 * Entries use **route signatures** (HTTP verb + class path + handler
 * path) — survives controller-class or method renames, since the URL
 * is the actual public contract.
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
 * Each entry is an **exact route signature** — `{ method, classPath,
 * handlerPath }`. There are no class-wide entries: a class-level entry
 * would silently approve any new handler added to that controller,
 * which contradicts the ADR-034 amendment process (every new
 * ApiKey-accepting surface must be an explicit, reviewed decision).
 * Per-handler entries force new handlers to fail this guardrail until
 * an ADR amendment + spec edit are landed for them specifically.
 *
 * `method` uses `RequestMethod` (NestJS enum). `classPath` and
 * `handlerPath` are the literal strings passed to `@Controller(...)`
 * and the HTTP-verb decorator (`@Get('me')`, `@Post(':id/switch')`,
 * etc.); leading/trailing slashes are stripped before comparison.
 * Handlers decorated with `@Get()` / `@Post()` (no path argument)
 * have `handlerPath === ''`.
 *
 * Source-side annotations stay class-level where it makes the auth
 * matrix readable (e.g. `@Auth(Bearer, ApiKey)` on
 * `OrganizationsController`); the per-handler precision lives in this
 * allowlist. The asymmetry is the safety property — if a new handler
 * is added inside an annotated class, the class annotation still
 * resolves ApiKey for it, but this allowlist will not contain a
 * matching route signature, so the test fails until both the ADR and
 * this list are updated.
 *
 * Stage 2 (`OA-03`) and Stage 4 (`OA-05`/`OA-06`) are expected to
 * narrow the transitional entries below — likely by removing or
 * tightening Org lifecycle entries. Stable entries (`AuthController.me`)
 * have no expected narrowing.
 *
 * The allowlist below mirrors the per-handler enumeration in ADR-034
 * §"Enumerated allowlist entries". Keep both in sync — the test
 * failure message instructs the next agent to update both.
 */
interface HandlerAllowlistEntry {
  method: RequestMethod
  classPath: string
  handlerPath: string
  reason: string
}

const ADR_034_APIKEY_ALLOWLIST: readonly HandlerAllowlistEntry[] = [
  // OrganizationsController — class @Auth(Bearer, ApiKey); every
  // handler below resolves to dual-auth. switchOrganization is NOT
  // listed because its handler-level @Auth(Bearer) override removes
  // ApiKey from the resolved auth-types (OA-01).
  // Transitional Stage 1c entries — Stage 2 (OA-03) expected to
  // narrow: create/list likely become Bearer-only, GET /:id likely
  // org-scoped only.
  {
    method: RequestMethod.POST,
    classPath: 'organizations',
    handlerPath: '',
    reason: 'create — Transitional (Stage 2 OA-03 may move to Bearer-only).',
  },
  {
    method: RequestMethod.GET,
    classPath: 'organizations',
    handlerPath: '',
    reason: 'findAll — Transitional (Stage 2 OA-03 may move to Bearer-only).',
  },
  {
    method: RequestMethod.GET,
    classPath: 'organizations',
    handlerPath: ':id',
    reason:
      'findOne — Transitional (Stage 2 OA-03 may restrict to principal.organizationId === :id).',
  },
  {
    method: RequestMethod.PATCH,
    classPath: 'organizations',
    handlerPath: ':id',
    reason:
      'update — Manage Organization via @CheckPolicies. Stable per ADR-033 (userPerms ∩ scopes).',
  },
  {
    method: RequestMethod.DELETE,
    classPath: 'organizations',
    handlerPath: ':id',
    reason:
      'remove — Manage Organization via @CheckPolicies. Stable per ADR-033 (userPerms ∩ scopes).',
  },

  // MembersController — class @Auth(Bearer, ApiKey); every handler
  // resolves to dual-auth. Transitional — Stage 4 (OA-05) may add
  // role-ownership narrowings on assign/remove role handlers, but
  // the auth-types matrix is not expected to change.
  {
    method: RequestMethod.POST,
    classPath: 'organizations/:orgId/members',
    handlerPath: 'invite',
    reason: 'invite — manage:Organization scope per ADR-033.',
  },
  {
    method: RequestMethod.DELETE,
    classPath: 'organizations/:orgId/members',
    handlerPath: ':userId',
    reason: 'removeMember — manage:Organization scope per ADR-033.',
  },
  {
    method: RequestMethod.POST,
    classPath: 'organizations/:orgId/members',
    handlerPath: ':userId/roles/:roleId',
    reason:
      'assignRole — manage:Organization scope per ADR-033. ' +
      'Transitional — Stage 4 (OA-05) may add role-ownership check.',
  },
  {
    method: RequestMethod.DELETE,
    classPath: 'organizations/:orgId/members',
    handlerPath: ':userId/roles/:roleId',
    reason:
      'removeRole — manage:Organization scope per ADR-033. ' +
      'Transitional — Stage 4 (OA-05) may add role-ownership check.',
  },

  // RolesController — class @Auth(Bearer, ApiKey); every handler
  // resolves to dual-auth. Transitional — Stage 4 (OA-06) is
  // expected to add assertOrgContext to listRoles. Auth-types matrix
  // unaffected; these entries stay after that change.
  {
    method: RequestMethod.GET,
    classPath: 'organizations/:orgId/roles',
    handlerPath: '',
    reason:
      'listRoles — manage:Organization scope per ADR-033. ' +
      'Transitional — Stage 4 (OA-06) is expected to add assertOrgContext.',
  },
  {
    method: RequestMethod.POST,
    classPath: 'organizations/:orgId/roles',
    handlerPath: '',
    reason: 'createRole — manage:Organization scope per ADR-033.',
  },
  {
    method: RequestMethod.PATCH,
    classPath: 'organizations/:orgId/roles',
    handlerPath: ':roleId',
    reason: 'updateRole — manage:Organization scope per ADR-033.',
  },
  {
    method: RequestMethod.DELETE,
    classPath: 'organizations/:orgId/roles',
    handlerPath: ':roleId',
    reason: 'deleteRole — manage:Organization scope per ADR-033.',
  },
  {
    method: RequestMethod.POST,
    classPath: 'organizations/:orgId/roles',
    handlerPath: ':roleId/permissions',
    reason: 'assignPermission — manage:Organization scope per ADR-033.',
  },
  {
    method: RequestMethod.DELETE,
    classPath: 'organizations/:orgId/roles',
    handlerPath: ':roleId/permissions/:permId',
    reason: 'removePermission — manage:Organization scope per ADR-033.',
  },

  // AuthController.me — handler-level @Auth(Bearer, ApiKey).
  // Stable opt-in per AK-01 — identity self-check surface.
  {
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
): HandlerAllowlistEntry | undefined {
  return ADR_034_APIKEY_ALLOWLIST.find(
    (entry) =>
      entry.method === method && entry.classPath === classPath && entry.handlerPath === handlerPath
  )
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
