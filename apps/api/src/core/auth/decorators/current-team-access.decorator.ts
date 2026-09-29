import { createParamDecorator, type ExecutionContext } from '@nestjs/common'

import type { TeamAccessDecision } from '../casl/ability.factory'

export const CurrentTeamAccess = createParamDecorator(
  (_: unknown, context: ExecutionContext): TeamAccessDecision => {
    const decision = context
      .switchToHttp()
      .getRequest<{ teamAccess?: TeamAccessDecision }>().teamAccess
    if (!decision) throw new Error('Missing TeamAccess decision')
    return decision
  }
)
