import { type DynamicModule, Global, Module } from '@nestjs/common'
import { TerminusModule } from '@nestjs/terminus'

import { LocalStorageProvider } from './providers/local-storage.provider'
import { MemoryStorageProvider } from './providers/memory-storage.provider'
import { S3StorageProvider } from './providers/s3-storage.provider'
import { STORAGE_PROVIDER } from './storage.constants'
import { StorageHealthIndicator } from './storage.health'
import type { StorageProvider } from './storage.interface'
import { StorageService } from './storage.service'

import { EnvModule } from '@/env/env.module'
import { EnvService } from '@/env/env.service'

/**
 * Global storage module. The active driver is chosen by `STORAGE_DRIVER`
 * (resolved in env.ts: dev -> local, test -> memory, production -> s3).
 * Exposes `StorageService` (facade) and `StorageHealthIndicator`.
 */
@Global()
@Module({})
export class StorageModule {
  static forRoot(): DynamicModule {
    return {
      module: StorageModule,
      // TerminusModule provides HealthIndicatorService, which
      // StorageHealthIndicator depends on.
      imports: [EnvModule, TerminusModule],
      providers: [
        {
          provide: STORAGE_PROVIDER,
          inject: [EnvService],
          useFactory: (env: EnvService): StorageProvider => createProvider(env),
        },
        StorageService,
        StorageHealthIndicator,
      ],
      exports: [StorageService, StorageHealthIndicator],
    }
  }
}

function createProvider(env: EnvService): StorageProvider {
  const driver = env.get('STORAGE_DRIVER')
  switch (driver) {
    case 'memory':
      return new MemoryStorageProvider()
    case 'local':
      return new LocalStorageProvider({
        root: env.get('STORAGE_LOCAL_ROOT'),
        publicBaseUrl: env.get('STORAGE_LOCAL_PUBLIC_BASE_URL'),
      })
    case 's3':
      // env.ts superRefine guarantees bucket + credentials are present when
      // STORAGE_DRIVER === 's3' (boot fails otherwise), so the assertions hold.
      return new S3StorageProvider({
        bucket: env.get('STORAGE_BUCKET')!,
        region: env.get('STORAGE_REGION'),
        accessKeyId: env.get('STORAGE_ACCESS_KEY_ID')!,
        secretAccessKey: env.get('STORAGE_SECRET_ACCESS_KEY')!,
        endpoint: env.get('STORAGE_ENDPOINT'),
        publicEndpoint: env.get('STORAGE_PUBLIC_ENDPOINT'),
        forcePathStyle: env.get('STORAGE_FORCE_PATH_STYLE'),
        signedUrlDefaultTtl: env.get('STORAGE_SIGNED_URL_DEFAULT_TTL'),
        signedUrlMaxTtl: env.get('STORAGE_SIGNED_URL_MAX_TTL'),
      })
    default:
      throw new Error(`Unknown storage driver: ${String(driver)}`)
  }
}
