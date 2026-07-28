import { RequestMethod } from '@nestjs/common'

/**
 * ADR-034 allowlist of routes that may opt in to `AuthType.ApiKey`.
 *
 * Each entry is an **exact route signature** — `{ method, classPath,
 * handlerPath }`. There are no class-wide entries: a class-level entry
 * would silently approve any new handler added to that controller,
 * which contradicts the ADR-034 amendment process (every new
 * ApiKey-accepting surface must be an explicit, reviewed decision).
 * Per-handler entries force new handlers to fail the guardrail below
 * until an ADR amendment + this list are landed for them specifically.
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
 * matching route signature, so the consuming guardrail fails until
 * both the ADR and this list are updated.
 *
 * This is the single source of truth for two independent guardrails:
 * `auth-decorator-coverage.spec.ts` (every ApiKey opt-in is enumerated
 * here) and `apps/api/test/openapi.e2e-spec.ts` (every enumerated route
 * documents the `apiKeyBearer` OpenAPI security scheme, and no other
 * route does). Keep both consuming this one list rather than
 * maintaining independent copies.
 *
 * Stage 2 (`OA-03`) and Stage 4 (`OA-05`/`OA-06`) are expected to
 * narrow the transitional entries below — likely by removing or
 * tightening Org lifecycle entries. Stable entries (`AuthController.me`)
 * have no expected narrowing.
 *
 * The allowlist below mirrors the per-handler enumeration in ADR-034
 * §"Enumerated allowlist entries". Keep both in sync — the coverage
 * spec's failure message instructs the next agent to update both.
 */
export interface HandlerAllowlistEntry {
  method: RequestMethod
  classPath: string
  handlerPath: string
  reason: string
}

export const ADR_034_APIKEY_ALLOWLIST: readonly HandlerAllowlistEntry[] = [
  // OrganizationsController — class @Auth(Bearer, ApiKey); per-handler
  // overrides apply. switchOrganization is NOT listed because its
  // handler-level @Auth(Bearer) override removes ApiKey from the
  // resolved auth-types (OA-01). create / findAll are NOT listed
  // because Stage 2 (OA-03) gave them handler-level @Auth(Bearer)
  // overrides — JWT-only (creation is interactive; listing leaks
  // org-membership topology beyond the key's bound org). The
  // remaining three entries are stable post-Stage 2.
  {
    method: RequestMethod.GET,
    classPath: 'organizations',
    handlerPath: ':id',
    reason:
      'findOne — service-level discriminating check enforces ' +
      'principal.organizationId === :id for api_key principals (OA-03). ' +
      'JWT principals keep membership-based read (no /switch required). Stable.',
  },
  {
    method: RequestMethod.PATCH,
    classPath: 'organizations',
    handlerPath: ':id',
    reason:
      'update — Manage Organization via @CheckPolicies + service-level assertOrgContext. ' +
      'Stable per ADR-033 (userPerms ∩ scopes).',
  },
  {
    method: RequestMethod.DELETE,
    classPath: 'organizations',
    handlerPath: ':id',
    reason:
      'remove — Manage Organization via @CheckPolicies + service-level assertOrgContext. ' +
      'Stable per ADR-033 (userPerms ∩ scopes).',
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
