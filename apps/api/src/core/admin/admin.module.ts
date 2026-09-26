import { Module } from '@nestjs/common'

import { GeoipModule } from '../../infrastructure/geoip/geoip.module'
import { CleanupModule } from '../../infrastructure/schedule/cleanup.module'
import { PrismaModule } from '../../prisma'
import { AuditModule } from '../audit'

import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'
import { AdminAuditService } from './admin-audit.service'
import { AdminDetailService } from './admin-detail.service'
import { AdminOverviewService } from './admin-overview.service'
import { AdminSessionsService } from './admin-sessions.service'

import { HealthModule } from '@/health'

// Imports CleanupModule (not ScheduleModule): AdminController's manual
// POST /admin/cleanup needs CleanupService, but must NOT pull in the scheduler
// — otherwise the nightly cron would fire in the `web` role too (ADR-041).
// Imports HealthModule so the Overview endpoint reuses the same
// ReadinessCheckService as the public `/health` probes. GeoipModule is a
// plain leaf module (no scheduler discovery of its own), so importing it
// here for AdminSessionsService's location lookups carries the same "safe
// everywhere" property as CleanupModule.
@Module({
  imports: [PrismaModule, CleanupModule, AuditModule, HealthModule, GeoipModule],
  controllers: [AdminController],
  providers: [
    AdminService,
    AdminDetailService,
    AdminOverviewService,
    AdminAuditService,
    AdminSessionsService,
  ],
})
export class AdminModule {}
