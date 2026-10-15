import type { Env } from '../../env'

import { LocalStorageProvider } from './providers/local-storage.provider'
import { MemoryStorageProvider } from './providers/memory-storage.provider'
import { S3StorageProvider } from './providers/s3-storage.provider'
import type { StorageProvider } from './storage.interface'

/** Anything that reads validated configuration: the Nest `EnvService` or a plain object. */
export interface StorageConfigSource {
  get<K extends keyof Env>(key: K): Env[K]
}

/**
 * Build the driver selected by `STORAGE_DRIVER`. Shared by the Nest module and the
 * operator command (`storage:check`), so both use exactly the same configuration rules.
 */
export function createStorageProvider(env: StorageConfigSource): StorageProvider {
  const driver = env.get('STORAGE_DRIVER')
  switch (driver) {
    case 'memory':
      return new MemoryStorageProvider()
    case 'local':
      return new LocalStorageProvider({
        root: env.get('STORAGE_LOCAL_ROOT'),
        publicBaseUrl: env.get('STORAGE_PUBLIC_BASE_URL'),
      })
    case 's3':
      // env.ts superRefine guarantees bucket, credentials and the public base are
      // present when STORAGE_DRIVER === 's3' (boot fails otherwise), so the assertions hold.
      return new S3StorageProvider({
        bucket: env.get('STORAGE_BUCKET')!,
        publicBucket: env.get('STORAGE_PUBLIC_BUCKET'),
        region: env.get('STORAGE_REGION'),
        accessKeyId: env.get('STORAGE_ACCESS_KEY_ID')!,
        secretAccessKey: env.get('STORAGE_SECRET_ACCESS_KEY')!,
        endpoint: env.get('STORAGE_ENDPOINT'),
        presignEndpoint: env.get('STORAGE_PRESIGN_ENDPOINT'),
        publicDelivery: env.get('STORAGE_PUBLIC_DELIVERY'),
        publicBaseUrl: env.get('STORAGE_PUBLIC_BASE_URL')!,
        forcePathStyle: env.get('STORAGE_FORCE_PATH_STYLE'),
        signedUrlDefaultTtl: env.get('STORAGE_SIGNED_URL_DEFAULT_TTL'),
        signedUrlMaxTtl: env.get('STORAGE_SIGNED_URL_MAX_TTL'),
      })
    default:
      throw new Error(`Unknown storage driver: ${String(driver)}`)
  }
}
