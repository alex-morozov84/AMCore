import { Module } from '@nestjs/common'

import { PrismaModule } from '../../prisma/index.js'
import { AuditModule } from '../audit/index.js'

import { ApiKeyAbuseLimiterService } from './api-key-abuse-limiter.service.js'
import { ApiKeyRevocationService } from './api-key-revocation.service.js'
import { ApiKeysController } from './api-keys.controller.js'
import { ApiKeysService } from './api-keys.service.js'
import { ApiKeyGuard } from './guards/api-key.guard.js'

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [ApiKeysController],
  providers: [ApiKeyRevocationService, ApiKeysService, ApiKeyAbuseLimiterService, ApiKeyGuard],
  exports: [ApiKeyGuard],
})
export class ApiKeysModule {}
