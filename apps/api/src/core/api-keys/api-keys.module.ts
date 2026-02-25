import { Module } from '@nestjs/common'

import { PrismaModule } from '../../prisma'

import { ApiKeysController } from './api-keys.controller'
import { ApiKeysService } from './api-keys.service'
import { ApiKeyGuard } from './guards/api-key.guard'

@Module({
  imports: [PrismaModule],
  controllers: [ApiKeysController],
  providers: [ApiKeysService, ApiKeyGuard],
  exports: [ApiKeyGuard],
})
export class ApiKeysModule {}
