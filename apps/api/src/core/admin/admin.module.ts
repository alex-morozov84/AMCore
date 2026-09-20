import { Module } from '@nestjs/common'

import { CleanupModule } from '../../infrastructure/schedule/cleanup.module'
import { PrismaModule } from '../../prisma'
import { AuditModule } from '../audit'

import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'
import { AdminOverviewService } from './admin-overview.service'

import { HealthModule } from '@/health'

// Imports CleanupModule (not ScheduleModule): AdminController's manual
// POST /admin/cleanup needs CleanupService, but must NOT pull in the scheduler
// — otherwise the nightly cron would fire in the `web` role too (ADR-041).
// Imports HealthModule so the Overview endpoint reuses the same
// ReadinessCheckService as the public `/health` probes.
@Module({
  imports: [PrismaModule, CleanupModule, AuditModule, HealthModule],
  controllers: [AdminController],
  providers: [AdminService, AdminOverviewService],
})
export class AdminModule {}
