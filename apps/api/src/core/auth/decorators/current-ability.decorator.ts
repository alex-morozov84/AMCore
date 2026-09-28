import { createParamDecorator, type ExecutionContext } from '@nestjs/common'

import type { AppAbility } from '../casl/ability.factory'

/**
 * @CurrentAbility() decorator - Extract CASL ability from request
 *
 * The ability is created once per request by AuthenticationGuard
 * and attached to request.ability.
 *
 * Usage in controllers:
 * ```typescript
 * @Get('contacts')
 * async findAll(@CurrentAbility() ability: AppAbility) {
 *   return this.contactsService.findAll(ability)
 * }
 * ```
 *
 * Services must authorize actual records and fields. For the typed Prisma
 * wrapper, existing-pool extension, tenant predicates and whole-row deletion,
 * see docs/auth/rbac.md's executable Role recipe.

 */
export const CurrentAbility = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AppAbility => {
    const request = ctx.switchToHttp().getRequest()
    return request.ability
  }
)
