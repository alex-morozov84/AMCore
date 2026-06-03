import { Module } from '@nestjs/common'

import { CleanupModule } from '../../infrastructure/schedule/cleanup.module'
import { PrismaModule } from '../../prisma'

import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'

// Imports CleanupModule (not ScheduleModule): AdminController's manual
// POST /admin/cleanup needs CleanupService, but must NOT pull in the scheduler
// — otherwise the nightly cron would fire in the `web` role too (ADR-041).
@Module({
  imports: [PrismaModule, CleanupModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
