import { createParamDecorator, type ExecutionContext } from '@nestjs/common'

import type { RequestPrincipal } from '@amcore/shared'

export const CurrentUser = createParamDecorator(
  (data: keyof RequestPrincipal | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest()
    const user = request.user as RequestPrincipal

    return data ? user?.[data] : user
  }
)
