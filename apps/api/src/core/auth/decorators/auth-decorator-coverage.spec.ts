/**
 * Stage 1a guardrail for OA-11.
 *
 * The runtime default of `AuthenticationGuard` is permissive
 * (`[AuthType.Bearer, AuthType.ApiKey]`), which means any controller in
 * `apps/api/src/core/**` that forgets `@Auth(...)` silently accepts API
 * keys — including on routes that mint JWTs or perform platform-admin
 * operations (`OA-01` and `OA-02` were both downstream of this).
 *
 * This test fails if any HTTP handler in `apps/api/src/core/**` does
 * not have `@Auth(...)` declared explicitly at either the handler or
 * the controller-class level. It is intentionally a static
 * introspection — no `AppModule` boot needed — so the cost is a few
 * dynamic imports and metadata lookups.
 *
 * Why a Nest metadata test and not an ESLint rule:
 *   AST-level matching is fragile for Nest semantics. The decorator
 *   alias may be renamed at import; controllers may inherit from a
 *   base class; class-level decorators must be checked alongside
 *   handler-level decorators with `getAllAndOverride` precedence. The
 *   runtime metadata is the source of truth that `AuthenticationGuard`
 *   actually reads, so we check exactly that.
 *
 * Why a filesystem walk and not `AppModule` boot:
 *   This is a unit test — fast, deterministic, no DB / Redis / port
 *   binding. The discovery surface ("everything in `core/**` that ends
 *   in `.controller.ts`") matches the OA-11 scope precisely.
 *
 * After Stage 1c flips the default in `AuthenticationGuard` to
 * `[AuthType.Bearer]` (gated by ADR-034), this test must be updated to
 * also assert that `AuthType.ApiKey` is declared only by controllers in
 * the ADR-034 allowlist.
 *
 * See `ai/ORGANIZATIONS_ADMIN_REVIEW.md` OA-11 and ADR-034.
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

import { PATH_METADATA } from '@nestjs/common/constants'

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

interface HandlerViolation {
  controller: string
  method: string
  file: string
}

describe('Core controllers — @Auth decorator coverage (OA-11 guardrail)', () => {
  it('every HTTP handler under apps/api/src/core/** declares explicit @Auth metadata', async () => {
    const files = await findControllerFiles(CORE_DIR)

    // Sanity: the project actually has controllers in core/**. If this
    // ever returns 0, the test would silently pass and the guardrail
    // would be a no-op.
    expect(files.length).toBeGreaterThan(0)

    const violations: HandlerViolation[] = []
    const inspectedControllers: string[] = []

    for (const file of files) {
      const mod: Record<string, unknown> = await import(file)
      for (const [exportName, exported] of Object.entries(mod)) {
        if (typeof exported !== 'function') continue
        // NestJS @Controller(...) writes PATH_METADATA on the class
        // itself. That's the most accurate way to identify a Nest
        // controller without booting the module.
        const ctorMetadata = Reflect.getMetadata(PATH_METADATA, exported) as
          | string
          | string[]
          | undefined
        if (ctorMetadata === undefined) continue

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
          const handlerPath = Reflect.getMetadata(PATH_METADATA, handler)
          if (handlerPath === undefined) continue

          // Mirror `Reflector.getAllAndOverride` precedence: handler
          // metadata wins over class metadata. We call Reflect
          // directly to avoid the type plumbing — both lookups return
          // the same payload format the runtime guard reads.
          const handlerAuth = Reflect.getMetadata(AUTH_TYPE_KEY, handler) as unknown
          const classAuth = Reflect.getMetadata(AUTH_TYPE_KEY, cls) as unknown
          const authTypes = handlerAuth ?? classAuth

          if (authTypes === undefined) {
            violations.push({
              controller: exportName,
              method: methodName,
              file: path.relative(CORE_DIR, file),
            })
          }
        }
      }
    }

    // Same sanity check at the controller level — if we walked files
    // but found no controllers at all, the loop above did not actually
    // exercise anything. Keep the guardrail honest.
    expect(inspectedControllers.length).toBeGreaterThan(0)

    if (violations.length > 0) {
      const lines = [
        `Found ${violations.length} HTTP handler(s) under apps/api/src/core/** without explicit @Auth(...):`,
        ...violations.map((v) => `  - ${v.controller}.${v.method}   (${v.file})`),
        '',
        'Every handler under core/** must declare @Auth(...) — either at the',
        'handler or at the controller-class level. The implicit default',
        '[AuthType.Bearer, AuthType.ApiKey] is being removed in Stage 1c per',
        'ADR-034 (Auth Default — Bearer-Only). Until then, this guardrail',
        'enforces that the matrix is auditable.',
        '',
        'See ai/ORGANIZATIONS_ADMIN_REVIEW.md OA-11.',
      ]
      throw new Error(lines.join('\n'))
    }
  })
})
