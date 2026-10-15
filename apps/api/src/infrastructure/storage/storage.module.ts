import { type DynamicModule, Global, Module } from '@nestjs/common'
import { TerminusModule } from '@nestjs/terminus'

import { EnvModule } from '../../env/env.module.js'
import { EnvService } from '../../env/env.service.js'
import { ObservabilityModule } from '../observability/index.js'

import { STORAGE_PROVIDER } from './storage.constants.js'
import { StorageHealthIndicator } from './storage.health.js'
import type { StorageProvider } from './storage.interface.js'
import { StorageService } from './storage.service.js'
import { ANONYMOUS_READ, readAnonymously } from './storage-anonymous-read.js'
import { StorageDownloadService } from './storage-download.service.js'
import { StorageProbeIo } from './storage-probe.io.js'
import { StorageProbeService } from './storage-probe.service.js'
import { createStorageProvider } from './storage-provider.factory.js'
import { StoragePublicCheckService } from './storage-public-check.service.js'

/**
 * Global storage module. The active driver is chosen by `STORAGE_DRIVER`
 * (resolved in env.ts: dev -> local, test -> memory, production -> s3).
 * Exposes `StorageService` (facade), `StorageDownloadService` (an unauthorized
 * download primitive a consumer must guard), and `StorageHealthIndicator`.
 *
 * No download controller is registered here: the app-mediated download route is
 * mounted by an authorized consumer (a later stage), never as a generic
 * bearer-only `/storage/objects/*` endpoint.
 */
@Global()
@Module({})
export class StorageModule {
  static forRoot(): DynamicModule {
    return {
      module: StorageModule,
      // TerminusModule provides HealthIndicatorService, which
      // StorageHealthIndicator depends on.
      imports: [EnvModule, TerminusModule, ObservabilityModule],
      providers: [
        {
          provide: STORAGE_PROVIDER,
          inject: [EnvService],
          useFactory: (env: EnvService): StorageProvider => createStorageProvider(env),
        },
        StorageService,
        StorageDownloadService,
        StorageHealthIndicator,
        StorageProbeIo,
        { provide: ANONYMOUS_READ, useValue: readAnonymously },
        StorageProbeService,
        StoragePublicCheckService,
      ],
      exports: [
        StorageService,
        StorageDownloadService,
        StorageHealthIndicator,
        StorageProbeService,
        StoragePublicCheckService,
      ],
    }
  }
}
