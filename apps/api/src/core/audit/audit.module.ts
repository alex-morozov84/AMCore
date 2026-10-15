import { Module } from '@nestjs/common'

import { PrismaModule } from '../../prisma/index.js'

import { AuditLogService } from './audit-log.service.js'

@Module({
  imports: [PrismaModule],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}
