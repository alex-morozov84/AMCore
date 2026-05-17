import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { AuthType } from '@amcore/shared'

import { UnauthorizedException } from '../../../common/exceptions'
import { ApiKeyGuard } from '../../api-keys/guards/api-key.guard'
import { AbilityFactory } from '../casl/ability.factory'
import { AUTH_TYPE_KEY } from '../decorators/auth.decorator'

import { JwtAuthGuard } from './jwt-auth.guard'
import { PoliciesGuard } from './policies.guard'
import { SystemRolesGuard } from './system-roles.guard'

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
 * 4. Create CASL ability from user permissions and attach to request.ability
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
    private readonly policiesGuard: PoliciesGuard
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Default fallback is [AuthType.Bearer] per ADR-034 — see
    // `apps/api/src/core/auth/decorators/auth.decorator.ts` JSDoc and
    // ADR-034 in `ai/DECISIONS.md` for the rationale (fail-safe default,
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
      return true
    }

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

      try {
        if (await guard.canActivate(context)) {
          authenticated = true
          break
        }
      } catch (err) {
        if (!isDecisionError(err)) throw err
        // decision-class — try next auth type
      }
    }

    if (!authenticated) {
      throw new UnauthorizedException()
    }

    // 4. Create ability and attach to request
    const request = context.switchToHttp().getRequest()
    const user = request.user

    if (user) {
      const ability = await this.abilityFactory.createForUser(user)
      request.ability = ability
    }

    // 5. Run authorization guards.
    // These now throw domain ForbiddenException on denial rather than return false,
    // so the response always carries a machine-readable errorCode.
    await this.systemRolesGuard.canActivate(context)
    await this.policiesGuard.canActivate(context)

    return true
  }
}
