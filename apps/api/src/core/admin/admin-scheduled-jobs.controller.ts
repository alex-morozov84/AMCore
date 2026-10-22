import { Controller, Get, Header, Param } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'

import {
  AuthType,
  scheduledJobIdSchema,
  type ScheduledJobsResponse,
  type ScheduledRunsResponse,
  SystemRole,
} from '@amcore/shared'

import { SchemaResponse } from '../../common/schemas/schema-response.js'
import { Auth } from '../auth/decorators/auth.decorator.js'
import { SystemRoles } from '../auth/decorators/system-roles.decorator.js'

import { AdminScheduledJobsService } from './admin-scheduled-jobs.service.js'
import { ScheduledJobsResponseDto, ScheduledRunsResponseDto } from './dto/scheduled-jobs.dto.js'

/**
 * Bearer-only like every admin route: an API key owned by a SUPER_ADMIN must not satisfy the
 * system-role check. The path stays under `admin/background-work` next to the queue summary and
 * outside the Bull Board mount.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/background-work/scheduled-jobs')
@Auth(AuthType.Bearer)
@SystemRoles(SystemRole.SuperAdmin)
@ApiResponse({ status: 401, description: 'Bearer JWT required; API keys rejected' })
@ApiResponse({ status: 403, description: 'SUPER_ADMIN required' })
@ApiResponse({ status: 429, description: 'Rate limit exceeded' })
export class AdminScheduledJobsController {
  constructor(private readonly jobs: AdminScheduledJobsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Read recorded results of scheduled (periodic) jobs — live SUPER_ADMIN bearer only',
    description:
      'One row per job of the code-owned catalogue (at most 64). Configuration, last result and ' +
      'freshness are separate fields: a job can be partial and stale at once. Data is what workers ' +
      'recorded; it does not guarantee future runs or the health of every replica. A job no worker ' +
      'has reported is `not_reported`. Only counters and codes are returned: no error messages, ' +
      'row content or payloads.',
  })
  @SchemaResponse({
    type: ScheduledJobsResponseDto,
    status: 200,
    description: 'Scheduled job evidence computed at read time on the database clock',
  })
  list(): Promise<ScheduledJobsResponse> {
    return this.jobs.list()
  }

  @Get(':jobId/runs')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Read the retained run history of one daily scheduled job',
    description:
      'Newest first, at most 20 runs; `truncated` says older retained runs exist. Only daily jobs ' +
      'keep history: frequent jobs and unknown ids answer 404.',
  })
  @ApiParam({ name: 'jobId', description: 'Scheduled job id from the list' })
  @ApiResponse({ status: 400, description: 'Malformed job id' })
  @ApiResponse({ status: 404, description: 'Unknown job or a job without run history' })
  @SchemaResponse({
    type: ScheduledRunsResponseDto,
    status: 200,
    description: 'Retained runs of one job',
  })
  runs(
    @Param('jobId', { schema: scheduledJobIdSchema }) jobId: string
  ): Promise<ScheduledRunsResponse> {
    return this.jobs.runs(jobId)
  }
}
