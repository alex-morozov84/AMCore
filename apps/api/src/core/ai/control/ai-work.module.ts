import { Module } from '@nestjs/common'

import { AiRunService } from '../runs/ai-run.service'

import { aiRunExecutionsWork } from './ai-run-executions.work'
import { AiWorkCleanup } from './ai-work-cleanup'
import { AiWorkControl } from './ai-work-control'
import { AiWorkReader } from './ai-work-reader'
import { AiWorkRetry } from './ai-work-retry'

import { AuditModule } from '@/core/audit'
import { AiCatalogModule } from '@/infrastructure/ai/ai-catalog.module'
import { PrismaModule } from '@/prisma'

/** Backend durable authority survives every optional Console frontend topology. */
@Module({
  imports: [PrismaModule, AuditModule, AiCatalogModule],
  providers: [
    AiRunService,
    AiWorkReader,
    AiWorkControl,
    AiWorkRetry,
    AiWorkCleanup,
    { provide: aiRunExecutionsWork.tokens.reader, useExisting: AiWorkReader },
    { provide: aiRunExecutionsWork.tokens.control, useExisting: AiWorkControl },
  ],
  exports: [aiRunExecutionsWork.tokens.reader, aiRunExecutionsWork.tokens.control],
})
export class AiWorkModule {}
