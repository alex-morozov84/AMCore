import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import type { AppAbility } from '../casl/ability.factory'
import {
  CHECK_POLICIES_KEY,
  type IPolicyHandler,
  type PolicyHandler,
} from '../decorators/check-policies.decorator'

/**
 * PoliciesGuard
 *
 * Executes @CheckPolicies handlers to validate user permissions.
 *
 * Flow:
 * 1. Reflector extracts policy handlers from @CheckPolicies decorator
 * 2. Gets ability from request (attached by AuthenticationGuard)
 * 3. Executes each handler with ability
 * 4. All handlers must return true for access to be granted
 *
 * Note: This guard must run AFTER AuthenticationGuard which populates request.ability
 *
 * Usage in controllers:
 * ```typescript
 * @CheckPolicies((ability) => ability.can(Action.Read, Subject.Contact))
 * @Get('contacts')
 * findAll() {}
 * ```
 */
@Injectable()
export class PoliciesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Get policy handlers from @CheckPolicies decorator
    const policyHandlers =
      this.reflector.get<PolicyHandler[]>(CHECK_POLICIES_KEY, context.getHandler()) || []

    // If no policies defined, allow access
    if (policyHandlers.length === 0) {
      return true
    }

    // Get ability from request (populated by AuthenticationGuard)
    const request = context.switchToHttp().getRequest()
    const ability: AppAbility = request.ability

    // If no ability on request, deny access
    if (!ability) {
      return false
    }

    // Execute all policy handlers - all must return true
    return policyHandlers.every((handler) => this.execPolicyHandler(handler, ability))
  }

  /**
   * Execute a policy handler
   *
   * Supports two types of handlers:
   * 1. Function: (ability) => ability.can(Action.Read, Subject.Contact)
   * 2. Class implementing IPolicyHandler with handle(ability) method
   */
  private execPolicyHandler(handler: PolicyHandler, ability: AppAbility): boolean {
    if (typeof handler === 'function') {
      return handler(ability)
    }
    return (handler as IPolicyHandler).handle(ability)
  }
}
