import { Module } from '@nestjs/common'

import { GeoipModule } from '../../infrastructure/geoip/geoip.module'
import { CleanupModule } from '../../infrastructure/schedule/cleanup.module'
import { PrismaModule } from '../../prisma'
import { ApiKeyRevocationService } from '../api-keys/api-key-revocation.service'
import { AuditModule } from '../audit'

import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'
import { AdminApiKeysController } from './admin-api-keys.controller'
import { AdminApiKeysService } from './admin-api-keys.service'
import { AdminAuditService } from './admin-audit.service'
import { AdminDetailService } from './admin-detail.service'
import { AdminOverviewService } from './admin-overview.service'
import { AdminOverviewResourcesService } from './admin-overview-resources.service'
import { AdminQueuesController } from './admin-queues.controller'
import { AdminQueuesService } from './admin-queues.service'
import { AdminSessionsService } from './admin-sessions.service'
import { AdminStorageSettingController } from './admin-storage-setting.controller'
import { AdminStorageSettingService } from './admin-storage-setting.service'
import { BackgroundControlModule } from './background-control.module'
import { BackgroundWorkController } from './background-work.controller'
import { BackgroundWorkService } from './background-work.service'
import { BackgroundWorkCatalogue } from './background-work-catalogue'
import { BackgroundWorkReader } from './background-work-reader'
import { PlatformSettingsPrincipalGuard } from './platform-settings-principal.guard'

import { HealthModule } from '@/health'
import { QueueModule } from '@/infrastructure/queue'

// Imports CleanupModule (not ScheduleModule): AdminController's manual
// POST /admin/cleanup needs CleanupService, but must NOT pull in the scheduler
// — otherwise the nightly cron would fire in the `web` role too (ADR-041).
// Imports HealthModule so the Overview endpoint reuses the same
// ReadinessCheckService as the public `/health` probes. GeoipModule is a
// plain leaf module (no scheduler discovery of its own), so importing it
// here for AdminSessionsService's location lookups carries the same "safe
// everywhere" property as CleanupModule.
@Module({
  imports: [
    PrismaModule,
    CleanupModule,
    AuditModule,
    HealthModule,
    GeoipModule,
    QueueModule,
    BackgroundControlModule,
  ],
  controllers: [
    AdminController,
    AdminApiKeysController,
    AdminStorageSettingController,
    AdminQueuesController,
    BackgroundWorkController,
  ],
  providers: [
    AdminService,
    AdminStorageSettingService,
    PlatformSettingsPrincipalGuard,
    AdminApiKeysService,
    ApiKeyRevocationService,
    AdminDetailService,
    AdminOverviewService,
    AdminOverviewResourcesService,
    AdminAuditService,
    AdminSessionsService,
    AdminQueuesService,
    BackgroundWorkService,
    BackgroundWorkCatalogue,
    BackgroundWorkReader,
  ],
})
export class AdminModule {}
