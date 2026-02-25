import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { AuthType } from '@amcore/shared'

import { ApiKeyGuard } from '../../api-keys/guards/api-key.guard'
import { AbilityFactory } from '../casl/ability.factory'
import { AUTH_TYPE_KEY } from '../decorators/auth.decorator'

import { JwtAuthGuard } from './jwt-auth.guard'
import { PoliciesGuard } from './policies.guard'
import { SystemRolesGuard } from './system-roles.guard'

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
    // 1. Get auth types from @Auth() decorator (default: [AuthType.Bearer])
    const authTypes = this.reflector.getAllAndOverride<AuthType[]>(AUTH_TYPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? [AuthType.Bearer]

    // 2. If public route (AuthType.None), skip all checks
    if (authTypes.includes(AuthType.None)) {
      return true
    }

    // 3. Authenticate - try each auth type until one succeeds
    let authenticated = false
    for (const type of authTypes) {
      if (type === AuthType.Bearer) {
        const result = await this.jwtAuthGuard.canActivate(context)
        if (result) {
          authenticated = true
          break
        }
      }

      if (type === AuthType.ApiKey) {
        const result = await this.apiKeyGuard.canActivate(context)
        if (result) {
          authenticated = true
          break
        }
      }
    }

    if (!authenticated) {
      return false
    }

    // 4. Create ability and attach to request
    const request = context.switchToHttp().getRequest()
    const user = request.user

    if (user) {
      const ability = await this.abilityFactory.createForUser(user)
      request.ability = ability
    }

    // 5. Run authorization guards
    const systemRolesCheck = await this.systemRolesGuard.canActivate(context)
    if (!systemRolesCheck) {
      return false
    }

    const policiesCheck = await this.policiesGuard.canActivate(context)
    if (!policiesCheck) {
      return false
    }

    return true
  }
}
