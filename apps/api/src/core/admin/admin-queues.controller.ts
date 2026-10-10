import { Controller, Get, Header } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'

import { type AdminQueuesResponse, AuthType, SystemRole } from '@amcore/shared'

import { Auth } from '../auth/decorators/auth.decorator'
import { SystemRoles } from '../auth/decorators/system-roles.decorator'

import { AdminQueuesService } from './admin-queues.service'
import { AdminQueuesResponseDto } from './dto/admin-queues.dto'

/**
 * Bearer-only (OA-02, like every admin route): an API key owned by a SUPER_ADMIN must not
 * satisfy the system-role check. The path deliberately avoids `/admin/queues`, which the Bull
 * Board middleware owns wherever the board is mounted.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/background-work/queues')
@Auth(AuthType.Bearer)
@SystemRoles(SystemRole.SuperAdmin)
export class AdminQueuesController {
  constructor(private readonly queues: AdminQueuesService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Read-only background queue summary — live SUPER_ADMIN bearer only',
    description:
      'Registration-owned localized presentation labels, counts, global pause flag and a bounded creation-age sample for each queue of the code-owned inventory. ' +
      'No job payloads, ids, names or errors are returned. A queue whose Redis state cannot be read within ' +
      'a short deadline is reported as `unavailable` inside a 200 response.',
  })
  @ApiResponse({ status: 401, description: 'Bearer JWT required; API keys rejected' })
  @ApiResponse({ status: 403, description: 'SUPER_ADMIN required' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  @ZodResponse({
    type: AdminQueuesResponseDto,
    status: 200,
    description: 'Queue summary; per-queue unavailable/disabled states are data, not errors',
  })
  list(): Promise<AdminQueuesResponse> {
    return this.queues.list()
  }
}
