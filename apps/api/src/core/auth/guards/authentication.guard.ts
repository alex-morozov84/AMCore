import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'

import { AuthType } from '@amcore/shared'

import { BadRequestException, UnauthorizedException } from '../../../common/exceptions/index.js'
import { ApiKeyGuard } from '../../api-keys/guards/api-key.guard.js'
import { BrowserSessionContextService } from '../../frontend-context/browser-session-context.service.js'
import { AbilityFactory } from '../casl/ability.factory.js'
import { AUTH_TYPE_KEY } from '../decorators/auth.decorator.js'
import { beginJwtPrimaryAdmission } from '../mfa/jwt-primary-admission.js'
import { MfaJwtAdmissionService } from '../mfa/mfa-jwt-admission.service.js'
import { bindMfaPrincipal } from '../mfa/mfa-principal-binding.js'
import { contextPolicyMetadata } from '../organization-context/context-policy-metadata.js'
import { OrganizationContextResolver } from '../organization-context/organization-context-resolver.service.js'
import { organizationHeader } from '../organization-context/organization-selector.js'
import { PrivilegedAdmissionService } from '../privileged-admission.service.js'
import { type AuthBudget, AuthStageService } from '../stage/auth-stage.service.js'

import { JwtAuthGuard } from './jwt-auth.guard.js'
import { PoliciesGuard } from './policies.guard.js'
import { SystemRolesGuard } from './system-roles.guard.js'
import { TeamAccessGuard } from './team-access.guard.js'

/**
 * AK-11: distinguish decision-class failures from infrastructure failures
 * in the auth chain.
 *
 * Decision-class (401/403) means "this credential is not valid here, try
 * the next auth type" — swallow and continue the loop. Anything else is
 * infrastructure (database pool timeout → 503 via PrismaClientExceptionFilter
 * per ADR-032, Redis down → 500, rate limit overflow → 429 from AK-07,
 * unexpected runtime error → 500) and MUST propagate so the global filters
 * map it to the right status and so observability sees real failures
 * instead of a flood of fake 401s.
 *
 * Keep this discriminator narrow. Adding more statuses (e.g. 400) would
 * make the chain forgiving in ways it shouldn't be — schema validation
 * lives at the controller layer, not here.
 */
function isDecisionError(err: unknown): boolean {
  if (!(err instanceof HttpException)) return false
  const status = err.getStatus()
  return status === HttpStatus.UNAUTHORIZED || status === HttpStatus.FORBIDDEN
}

/**
 * AuthenticationGuard
 *
 * Single global guard that handles authentication AND authorization in correct order.
 *
 * Critical: This guard MUST run before PoliciesGuard and SystemRolesGuard
 * because it populates request.user and request.ability.
 *
 * Flow:
 * 1. Check @Auth() decorator to determine auth types (default: [AuthType.Bearer])
 * 2. If AuthType.None → skip authentication (public route)
 * 3. Run authentication guards (JWT, ApiKey) to populate request.user
 * 4. Resolve current privilege before creating CASL ability from effective permissions and attach to request.ability
 * 5. Run authorization guards (SystemRolesGuard, PoliciesGuard)
 *
 * Why single guard instead of multiple?
 * - Ensures correct execution order (auth → authz)
 * - Prevents race conditions where PoliciesGuard runs before JWT auth
 * - Ability created once per request (performance)
 *
 * Architecture:
 * Request → AuthenticationGuard
 *   ├─ Authenticate (JWT/ApiKey) → request.user
 *   ├─ Primary privilege admission → effective request.user
 *   ├─ Create ability → request.ability
 *   └─ Authorize (SystemRoles, Policies)
 * → Controller
 *
 * Reference: https://github.com/nestjs/nest/issues/5598
 */
@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtAuthGuard: JwtAuthGuard,
    private readonly apiKeyGuard: ApiKeyGuard,
    private readonly abilityFactory: AbilityFactory,
    private readonly systemRolesGuard: SystemRolesGuard,
    private readonly policiesGuard: PoliciesGuard,
    private readonly teamAccessGuard: TeamAccessGuard,
    private readonly privilegedAdmission: PrivilegedAdmissionService,
    private readonly organizationContext: OrganizationContextResolver,
    private readonly mfaAdmission: MfaJwtAdmissionService,
    private readonly browserContexts: BrowserSessionContextService,
    private readonly stage: AuthStageService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Normalize private browser proof before credential admission. Imported global
    // guards do not provide an ordering guarantee relative to this auth guard.
    const incoming = context.switchToHttp().getRequest<Request>()
    this.browserContexts.verify(incoming, incoming.headers)
    // Default fallback is [AuthType.Bearer]; explicit API-key opt-in preserves
    // fail-safe credential admission (
    // server-side industry alignment, and the OA-01/02 lineage that
    // motivated the flip from the prior permissive default). The
    // ADR-034 allowlist of routes that opt in to AuthType.ApiKey is
    // enforced by `auth-decorator-coverage.spec.ts` as a metadata test.
    const authTypes = this.reflector.getAllAndOverride<AuthType[]>(AUTH_TYPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? [AuthType.Bearer]

    // 2. If public route (AuthType.None), skip all checks
    if (authTypes.includes(AuthType.None)) {
      if (contextPolicyMetadata(context)?.kind === 'organization') {
        throw new Error('Organization context requires authenticated admission')
      }
      if (organizationHeader(context.switchToHttp().getRequest()) !== undefined) {
        throw new BadRequestException('Undeclared organization selector')
      }
      return true
    }

    // Steps 3-5 run under one absolute budget: at expiry the caller gets 503, the handler
    // never runs and late work is ignored (see AuthStageService).
    return this.stage.run((budget) => this.admit(context, authTypes, incoming, budget))
  }

  private async admit(
    context: ExecutionContext,
    authTypes: AuthType[],
    incoming: Request,
    budget: AuthBudget
  ): Promise<boolean> {
    // 3. Authenticate — try each auth type until one succeeds.
    // Both branches use the same isDecisionError discriminator: 401/403
    // means "wrong credential, try next"; anything else propagates so the
    // global filters can produce the correct status (503 for pool timeout,
    // 429 for rate-limit, 500 for unexpected). This is the AK-11 invariant
    // — see the JSDoc above isDecisionError for the policy rationale.
    let authenticated = false
    for (const type of authTypes) {
      const guard =
        type === AuthType.Bearer
          ? this.jwtAuthGuard
          : type === AuthType.ApiKey
            ? this.apiKeyGuard
            : null

      if (!guard) continue
      // A delayed `false` or 401/403 from the previous credential must not start the next one.
      budget.assertAlive()

      const release = type === AuthType.Bearer ? beginJwtPrimaryAdmission(incoming) : undefined
      try {
        if (await guard.canActivate(context)) {
          authenticated = true
          break
        }
      } catch (err) {
        if (!isDecisionError(err)) throw err
        // decision-class — try next auth type
      } finally {
        release?.()
      }
    }

    if (!authenticated) {
      throw new UnauthorizedException()
    }
    budget.assertAlive()

    // 4. Create ability and attach to request
    const request = context.switchToHttp().getRequest()
    const user = request.user

    if (user) {
      const evidence = await this.mfaAdmission.assert(request, user)
      budget.assertAlive()
      const privilege = await this.privilegedAdmission.resolve(
        user,
        this.systemRolesGuard.requiredRoles(context),
        evidence
      )
      budget.assertAlive()
      const { admission, context: verifiedContext } = await this.organizationContext.resolve(
        context,
        privilege
      )
      budget.assertAlive()
      request.privilegedAdmission = admission
      request.user = admission.principal
      bindMfaPrincipal(request, admission.principal)
      request.organizationContext = verifiedContext
      const authorization = await this.abilityFactory.createAuthorizationContext(
        admission,
        verifiedContext
      )
      budget.assertAlive()
      request.ability = authorization.ability
      request.teamAccess = authorization.teamAccess
    }

    // 5. Run authorization guards.
    // These now throw domain ForbiddenException on denial rather than return false,
    // so the response always carries a machine-readable errorCode.
    await this.systemRolesGuard.canActivate(context)
    budget.assertAlive()
    await this.policiesGuard.canActivate(context)
    budget.assertAlive()
    await this.teamAccessGuard.canActivate(context)
    budget.assertAlive()

    return true
  }
}
