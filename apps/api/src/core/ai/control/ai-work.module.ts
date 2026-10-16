import { Module } from '@nestjs/common'

import { AiCatalogModule } from '../../../infrastructure/ai/ai-catalog.module.js'
import { PrismaModule } from '../../../prisma/index.js'
import { AuditModule } from '../../audit/index.js'
import { AiRunService } from '../runs/ai-run.service.js'

import { aiRunExecutionsWork } from './ai-run-executions.work.js'
import { AiWorkCleanup } from './ai-work-cleanup.js'
import { AiWorkControl } from './ai-work-control.js'
import { AiWorkReader } from './ai-work-reader.js'
import { AiWorkRetry } from './ai-work-retry.js'

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
