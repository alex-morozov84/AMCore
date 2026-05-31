import { Test, type TestingModule } from '@nestjs/testing'

import { LocalStorageProvider } from './providers/local-storage.provider'
import { MemoryStorageProvider } from './providers/memory-storage.provider'
import { S3StorageProvider } from './providers/s3-storage.provider'
import { STORAGE_PROVIDER } from './storage.constants'
import { StorageHealthIndicator } from './storage.health'
import { StorageModule } from './storage.module'
import { StorageService } from './storage.service'

import { EnvService } from '@/env/env.service'

// Values the s3/local factory branches read; STORAGE_DRIVER is supplied per test.
const ENV_VALUES: Record<string, unknown> = {
  STORAGE_REGION: 'us-east-1',
  STORAGE_LOCAL_ROOT: './uploads',
  STORAGE_FORCE_PATH_STYLE: false,
  STORAGE_SIGNED_URL_DEFAULT_TTL: 3600,
  STORAGE_SIGNED_URL_MAX_TTL: 604800,
  STORAGE_BUCKET: 'test-bucket',
  STORAGE_ACCESS_KEY_ID: 'key',
  STORAGE_SECRET_ACCESS_KEY: 'secret',
}

function compileWith(driver: string): Promise<TestingModule> {
  return Test.createTestingModule({ imports: [StorageModule.forRoot()] })
    .overrideProvider(EnvService)
    .useValue({ get: (key: string) => (key === 'STORAGE_DRIVER' ? driver : ENV_VALUES[key]) })
    .compile()
}

describe('StorageModule', () => {
  it('wires StorageService and StorageHealthIndicator (real DI graph)', async () => {
    // Compiling the real module instantiates every provider — this would fail
    // if StorageHealthIndicator could not resolve HealthIndicatorService
    // (i.e. if TerminusModule were not imported).
    const moduleRef = await compileWith('memory')

    expect(moduleRef.get(StorageService)).toBeInstanceOf(StorageService)
    expect(moduleRef.get(StorageHealthIndicator)).toBeInstanceOf(StorageHealthIndicator)

    await moduleRef.close()
  })

  it.each([
    ['memory', MemoryStorageProvider],
    ['local', LocalStorageProvider],
    ['s3', S3StorageProvider],
  ])('selects the %s provider from STORAGE_DRIVER', async (driver, expectedProvider) => {
    const moduleRef = await compileWith(driver)

    expect(moduleRef.get(STORAGE_PROVIDER)).toBeInstanceOf(expectedProvider)

    await moduleRef.close()
  })
})
