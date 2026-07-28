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
 * The allowlist (`ADR_034_APIKEY_ALLOWLIST`, in `./adr-034-api-key-allowlist`)
 * is the canonical machine-readable form of ADR-034's enumerated allowlist,
 * shared with `apps/api/test/openapi.e2e-spec.ts` so both guardrails read
 * from one list. Every new ApiKey-accepting surface requires both an ADR
 * amendment AND a per-handler entry there — the test failure message tells
 * the next agent exactly that.
 *
 * Entries use **route signatures** (HTTP verb + class path + handler
 * path) — survives controller-class or method renames, since the URL
 * is the actual public contract.
 *
 * See ADR-034 in `ai/DECISIONS.md` and
 * `ai/ORGANIZATIONS_ADMIN_REVIEW.md` OA-11.
 */

// Loading each controller transitively pulls everything that controller
// depends on through Node's module graph. One tree in this repo carries
// an ESM-only dependency that ts-jest's default `transformIgnorePatterns`
// doesn't process:
//   - OAuth chain → `oauth-client.service` → `jose`
//
// (EmailModule → React-Email templates used to hit the same problem via
// `@react-email/components`; those primitives are now vendored first-party
// source, see infrastructure/email/react-email/NOTICE.md, so this tree no
// longer needs the workaround on that account — the mock below stays for
// EmailModule regardless, to keep unit tests free of real send side effects.)
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

import { ADR_034_APIKEY_ALLOWLIST, type HandlerAllowlistEntry } from './adr-034-api-key-allowlist'
import { AUTH_TYPE_KEY } from './auth.decorator'

const CORE_DIR = path.resolve(__dirname, '..', '..')

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
          string | string[] | undefined
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
            string | string[] | undefined
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
              RequestMethod | undefined
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
