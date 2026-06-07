import { Module } from '@nestjs/common'

import { PrismaModule } from '../../prisma'

import { AuditLogService } from './audit-log.service'

@Module({
  imports: [PrismaModule],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}
