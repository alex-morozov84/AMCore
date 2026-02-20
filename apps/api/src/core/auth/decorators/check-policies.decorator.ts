import { type CustomDecorator, SetMetadata } from '@nestjs/common'

import type { AppAbility } from '../casl/ability.factory'

/**
 * Metadata key for policy handlers
 */
export const CHECK_POLICIES_KEY = 'checkPolicies'

/**
 * Policy handler interface for class-based handlers
 */
export interface IPolicyHandler {
  handle(ability: AppAbility): boolean
}

/**
 * Policy handler function type
 * Takes an ability and returns true if allowed
 */
export type PolicyHandlerCallback = (ability: AppAbility) => boolean

/**
 * Policy handler - function or class implementing IPolicyHandler
 */
export type PolicyHandler = IPolicyHandler | PolicyHandlerCallback

/**
 * @CheckPolicies() decorator - Define authorization rules for a route
 *
 * Usage:
 * ```typescript
 * @CheckPolicies((ability) => ability.can(Action.Read, Subject.Contact))
 * @CheckPolicies((ability) => ability.can(Action.Manage, Subject.Organization))
 * ```
 *
 * Multiple handlers (all must pass):
 * ```typescript
 * @CheckPolicies(
 *   (ability) => ability.can(Action.Read, Subject.Contact),
 *   (ability) => ability.can(Action.Update, Subject.Contact)
 * )
 * ```
 *
 * @param handlers - One or more policy handler functions
 */
export const CheckPolicies = (...handlers: PolicyHandler[]): CustomDecorator<string> =>
  SetMetadata(CHECK_POLICIES_KEY, handlers)
