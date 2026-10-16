import { Module } from '@nestjs/common'

import { HealthModule } from '../../health/index.js'
import { GeoipModule } from '../../infrastructure/geoip/geoip.module.js'
import { QueueModule } from '../../infrastructure/queue/index.js'
import { CleanupModule } from '../../infrastructure/schedule/cleanup.module.js'
import { PrismaModule } from '../../prisma/index.js'
import { ApiKeyRevocationService } from '../api-keys/api-key-revocation.service.js'
import { AuditModule } from '../audit/index.js'

import { AdminController } from './admin.controller.js'
import { AdminService } from './admin.service.js'
import { AdminApiKeysController } from './admin-api-keys.controller.js'
import { AdminApiKeysService } from './admin-api-keys.service.js'
import { AdminAuditService } from './admin-audit.service.js'
import { AdminDetailService } from './admin-detail.service.js'
import { AdminOverviewService } from './admin-overview.service.js'
import { AdminOverviewResourcesService } from './admin-overview-resources.service.js'
import { AdminQueuesController } from './admin-queues.controller.js'
import { AdminQueuesService } from './admin-queues.service.js'
import { AdminSessionsService } from './admin-sessions.service.js'
import { AdminStorageSettingController } from './admin-storage-setting.controller.js'
import { AdminStorageSettingService } from './admin-storage-setting.service.js'
import { BackgroundControlModule } from './background-control.module.js'
import { BackgroundWorkController } from './background-work.controller.js'
import { BackgroundWorkService } from './background-work.service.js'
import { BackgroundWorkCatalogue } from './background-work-catalogue.js'
import { BackgroundWorkReader } from './background-work-reader.js'
import { OrganizationEstablishmentController } from './organization-establishment.controller.js'
import { PlatformSettingsPrincipalGuard } from './platform-settings-principal.guard.js'

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
    OrganizationEstablishmentController,
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
