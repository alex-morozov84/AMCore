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
 * Usage in services:
 * ```typescript
 * async findAll(ability: AppAbility) {
 *   return this.prisma.contact.findMany({
 *     where: accessibleBy(ability).Contact
 *   })
 * }
 * ```
 */
export const CurrentAbility = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AppAbility => {
    const request = ctx.switchToHttp().getRequest()
    return request.ability
  }
)
