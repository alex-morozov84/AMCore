import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'

import { envConfigOptions } from './env.config'
import { EnvModule } from './env.module'
import { EnvService } from './env.service'

const configuredEnvironment = () =>
  Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        ...envConfigOptions,
        ignoreEnvFile: true,
        validate: (input) =>
          envConfigOptions.validate!({
            ...input,
            DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/amcore',
            REDIS_URL: 'redis://localhost:6379',
            JWT_SECRET: 'fake-test-secret-at-least-32-characters',
            FRONTEND_URL: 'http://localhost:3002',
            NODE_ENV: 'test',
          }),
      }),
      EnvModule,
    ],
  }).compile()

describe('validated environment through Nest Config', () => {
  it.each(['', '12345'])('preserves the parsed heap override %p', async (raw) => {
    const previous = process.env.HEALTH_MEMORY_HEAP_BYTES
    let module: TestingModule | undefined
    process.env.HEALTH_MEMORY_HEAP_BYTES = raw
    try {
      module = await configuredEnvironment()
      const threshold = module.get(EnvService).get('HEALTH_MEMORY_HEAP_BYTES')
      expect(threshold).toBe(raw === '' ? undefined : 12345)
      expect(threshold ?? 1024 * 1024 * 1024).toBe(raw === '' ? 1024 * 1024 * 1024 : 12345)
    } finally {
      if (previous === undefined) delete process.env.HEALTH_MEMORY_HEAP_BYTES
      else process.env.HEALTH_MEMORY_HEAP_BYTES = previous
      await module?.close()
    }
  })

  it.each([undefined, '0.9', '0.75'])(
    'resolves disk readiness input %p through EnvService',
    async (raw) => {
      const previous = process.env.HEALTH_DISK_THRESHOLD_PERCENT
      let module: TestingModule | undefined
      if (raw === undefined) delete process.env.HEALTH_DISK_THRESHOLD_PERCENT
      else process.env.HEALTH_DISK_THRESHOLD_PERCENT = raw
      try {
        module = await configuredEnvironment()
        expect(module.get(EnvService).get('HEALTH_DISK_THRESHOLD_PERCENT')).toBe(
          raw === undefined ? 0.9 : Number(raw)
        )
      } finally {
        if (previous === undefined) delete process.env.HEALTH_DISK_THRESHOLD_PERCENT
        else process.env.HEALTH_DISK_THRESHOLD_PERCENT = previous
        await module?.close()
      }
    }
  )
})
