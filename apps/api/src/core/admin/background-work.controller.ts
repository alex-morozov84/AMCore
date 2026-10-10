import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, Res } from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import type { Response } from 'express'
import { ZodResponse, ZodValidationPipe } from 'nestjs-zod'
import { z } from 'zod'

import {
  adminQueueNameSchema,
  AuthType,
  type RequestPrincipal,
  SystemRole,
  type WorkJob,
  workJobIdSchema,
  type WorkListQuery,
  workListQuerySchema,
  type WorkPage,
  type WorkReceipt,
  type WorkSummary,
} from '@amcore/shared'

import { Auth } from '../auth/decorators/auth.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { SystemRoles } from '../auth/decorators/system-roles.decorator'

import { BackgroundWorkService } from './background-work.service'
import { BackgroundWorkCatalogue } from './background-work-catalogue'
import { BackgroundWorkReader } from './background-work-reader'
import {
  BackgroundWorkCatalogueDto,
  BackgroundWorkCommandDto,
  BackgroundWorkEvidenceReconciliationDto,
  BackgroundWorkJobDto,
  BackgroundWorkPageDto,
  BackgroundWorkReceiptDto,
  BackgroundWorkReconciliationDto,
} from './dto/background-work.dto'

import { NotFoundException } from '@/common/exceptions'

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/background-work')
@Auth(AuthType.Bearer)
@SystemRoles(SystemRole.SuperAdmin)
@ApiResponse({
  status: 401,
  description: 'Current personal bearer session required; API keys rejected',
})
@ApiResponse({
  status: 403,
  description: 'Current primary SUPER_ADMIN role required; actions require fresh authentication',
})
@ApiResponse({
  status: 409,
  description: 'Snapshot conflict, unsupported action, exhausted budget or storage ceiling',
})
@ApiResponse({ status: 429, description: 'Distributed request or target rate limit exceeded' })
@ApiResponse({
  status: 503,
  description: 'Required primary database or broker authority unavailable',
})
export class BackgroundWorkController {
  constructor(
    private readonly work: BackgroundWorkService,
    private readonly catalogue: BackgroundWorkCatalogue,
    private readonly reader: BackgroundWorkReader
  ) {}

  @Get('works')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Discover registered background work and current command capabilities',
    description:
      'Code-owned registrations are discovered automatically. Broker outages are per-resource unavailable states; ' +
      'authorization and distributed read budgets use primary PG. Optional registration-owned presentation supplies bounded localized names and safe field labels (English fallback). No job payloads or provider errors are returned.',
  })
  @ZodResponse({
    type: BackgroundWorkCatalogueDto,
    status: 200,
    description:
      'At most64 registered resources within64KiB encoded JSON; oversize returns503 WORK_UNAVAILABLE',
  })
  async list(@CurrentUser() principal: RequestPrincipal): Promise<WorkSummary[]> {
    return [...(await this.catalogue.list(principal))]
  }

  @Get('works/:workId/jobs')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Read a bounded status window of registered work',
    description:
      'At most50 safe rows within the first512 IDs. Live windows can change between reads; truncation ' +
      'and unavailable evidence are explicit. List rows<=2KiB including optional registered failure<=1KiB; page<=128KiB. ' +
      'Failure contains code and static localized title/nextStep maps with English fallback, only for a current failed attempt. ' +
      'No raw payloads, recipient data or provider errors.',
  })
  @ApiParam({ name: 'workId', description: 'Registered work ID' })
  @ApiQuery({
    name: 'state',
    required: false,
    enum: ['waiting', 'active', 'delayed', 'prioritized', 'failed', 'completed'],
  })
  @ApiQuery({
    name: 'source',
    required: false,
    enum: ['broker', 'PG_evidence'],
    description:
      'PG_evidence reads the first512 independent provider safety rows without Redis, ignoring broker state filter. ' +
      'Broker state/completed-attempt counts are unobserved; retained incarnations survive hash trim/recycled IDs. ' +
      'Unsupported replay policies return409. Does not establish missing jobs or effect success.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, minimum: 1, maximum: 512 })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 50 })
  @ApiResponse({ status: 400, description: 'Invalid status, page or registered work identifier' })
  @ZodResponse({
    type: BackgroundWorkPageDto,
    status: 200,
    description: 'Bounded safe window; reason/truncation are data',
  })
  jobs(
    @CurrentUser() principal: RequestPrincipal,
    @Param('workId', new ZodValidationPipe(adminQueueNameSchema)) workId: string,
    @Query(new ZodValidationPipe(workListQuerySchema)) query: WorkListQuery
  ): Promise<WorkPage> {
    return this.reader.list(principal, workId, query)
  }

  @Get('works/:workId/jobs/:jobId')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Read a registered work target’s safe diagnostics and action eligibility',
    description:
      'Capabilities are observations, not authorization. Every command rechecks captured identity and predicates. ' +
      'Detail<=16KiB; optional failure<=1KiB contains registered localized labels only. ' +
      'Idempotent broker history expires with the job hash; missing/unknown causes are omitted, not inferred. ' +
      'A diagnosis does not establish provider certainty or authorize a command.',
  })
  @ApiParam({ name: 'workId', description: 'Registered work ID' })
  @ApiParam({
    name: 'jobId',
    description: 'Bounded target ID; incarnation is returned in the identity',
  })
  @ApiResponse({ status: 400, description: 'Invalid work or target identifier' })
  @ApiResponse({ status: 404, description: 'Target history absent or expired' })
  @ZodResponse({
    type: BackgroundWorkJobDto,
    status: 200,
    description: 'Safe diagnostics and captured target revision',
  })
  async job(
    @CurrentUser() principal: RequestPrincipal,
    @Param('workId', new ZodValidationPipe(adminQueueNameSchema)) workId: string,
    @Param('jobId', new ZodValidationPipe(workJobIdSchema)) jobId: string
  ): Promise<WorkJob> {
    const row = await this.reader.detail(principal, workId, jobId)
    if (!row) throw new NotFoundException('Work target')
    return row
  }

  @Post('commands')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Request a registered background-work action',
    description:
      'Uses an immutable command ID and observed revisions. The durable receipt records each target separately. ' +
      'Repeating the same command returns its receipt; an unknown command is never redispatched. ' +
      'A 200 receipt does not imply that every target was applied. Bull Board remains read-only.',
  })
  @ApiResponse({ status: 400, description: 'Invalid command contract or parameters' })
  @ApiResponse({ status: 413, description: 'Command input exceeds the 32KiB byte ceiling' })
  @ApiResponse({
    status: 202,
    type: BackgroundWorkReceiptDto,
    description: 'Durable receipt with unconfirmed targets; never redispatch',
  })
  @ZodResponse({
    type: BackgroundWorkReceiptDto,
    status: 200,
    description: 'Durable per-target command receipt',
  })
  async execute(
    @CurrentUser() principal: RequestPrincipal,
    @Body() input: BackgroundWorkCommandDto,
    @Res({ passthrough: true }) response: Response
  ): Promise<WorkReceipt> {
    const receipt = await this.work.execute(principal, input)
    if (receipt.unknownCount > 0) response.status(202)
    return receipt
  }

  @Get('commands/:commandId')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Read your background-work command receipt',
    description:
      'Reads primary PG only. Does not redispatch a command, consume a manual grant or infer an effect from current broker state.',
  })
  @ApiParam({
    name: 'commandId',
    format: 'uuid',
    description: 'The requesting actor’s UUIDv7 command ID',
  })
  @ApiResponse({ status: 400, description: 'Invalid command ID' })
  @ApiResponse({ status: 404, description: 'No receipt owned by the current actor' })
  @ZodResponse({
    type: BackgroundWorkReceiptDto,
    status: 200,
    description: 'Current receipt; deadline expiry preserves uncertainty',
  })
  receipt(
    @CurrentUser() principal: RequestPrincipal,
    @Param('commandId', new ZodValidationPipe(z.uuidv7())) commandId: string
  ): Promise<WorkReceipt> {
    return this.work.receipt(principal, commandId)
  }

  @Post('commands/:commandId/reconciliation')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Acknowledge an irreducibly unknown ADMIN command without repeating it',
    description:
      'Fresh personal SUPER_ADMIN authentication, captured receipt revision, reason and at most3 opaque evidence ' +
      'references required. Ordinary work requires a fresh post-deadline Redis settlement barrier; durable work uses ' +
      'primary PG. Records acknowledged_unknown without changing unknown into success or rejection. Releases ADMIN ' +
      'conflict/execution slots only; protected uncertainty, spent grants and provider certainty remain unchanged.',
  })
  @ApiParam({
    name: 'commandId',
    format: 'uuid',
    description: 'Your retained UUIDv7 ADMIN command ID',
  })
  @ApiResponse({ status: 400, description: 'Invalid reconciliation contract' })
  @ApiResponse({ status: 404, description: 'No retained receipt owned by the current actor' })
  @ApiResponse({ status: 413, description: 'Decoded input exceeds32KiB' })
  @ZodResponse({
    type: BackgroundWorkReceiptDto,
    status: 200,
    description: 'Unknown outcome with separately audited operator disposition',
  })
  reconcile(
    @CurrentUser() principal: RequestPrincipal,
    @Param('commandId', new ZodValidationPipe(z.uuidv7())) commandId: string,
    @Body() input: BackgroundWorkReconciliationDto
  ): Promise<WorkReceipt> {
    return this.work.reconcile(principal, commandId, input)
  }

  @Post('works/:workId/jobs/:jobId/reconciliation')
  @HttpCode(204)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Record a provider uncertainty disposition independently of ADMIN commands',
    description:
      'Requires fresh personal SUPER_ADMIN authentication, evidence incarnation/revision, reason and bounded references. ' +
      'Only supported provider-window uncertainty is eligible. Active/unrecorded attempts cannot be acknowledged ' +
      'until the immutable provider horizon is certainly past under both timestamp uncertainty bounds. No provider, ' +
      'queue or business mutation. Aggregate certainty, attempt markers, starts, grants, commandFence ' +
      'and protected evidence quotas remain unchanged. Works after broker hash removal; idempotent work returns409.',
  })
  @ApiParam({ name: 'workId', description: 'Registered provider-window work ID' })
  @ApiParam({ name: 'jobId', description: 'Bounded job ID, paired with body incarnation' })
  @ApiResponse({
    status: 204,
    description: 'Strict audited metadata disposition committed; outcome remains unknown',
  })
  @ApiResponse({ status: 400, description: 'Invalid evidence identity or reconciliation body' })
  @ApiResponse({ status: 413, description: 'Decoded input exceeds32KiB' })
  reconcileEvidence(
    @CurrentUser() principal: RequestPrincipal,
    @Param('workId', new ZodValidationPipe(adminQueueNameSchema)) workId: string,
    @Param('jobId', new ZodValidationPipe(workJobIdSchema)) jobId: string,
    @Body() input: BackgroundWorkEvidenceReconciliationDto
  ): Promise<void> {
    return this.work.reconcileEvidence(principal, workId, jobId, input)
  }
}
