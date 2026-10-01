import { ConfigModule } from '@nestjs/config'
import { Test } from '@nestjs/testing'

import { envConfigOptions } from './env.config'
import { EnvModule } from './env.module'
import { EnvService } from './env.service'

describe('validated environment through Nest Config', () => {
  it.each(['', '12345'])('preserves the parsed heap override %p', async (raw) => {
    const previous = process.env.HEALTH_MEMORY_HEAP_BYTES
    process.env.HEALTH_MEMORY_HEAP_BYTES = raw
    try {
      const module = await Test.createTestingModule({
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
      const threshold = module.get(EnvService).get('HEALTH_MEMORY_HEAP_BYTES')
      expect(threshold).toBe(raw === '' ? undefined : 12345)
      expect(threshold ?? 1024 * 1024 * 1024).toBe(raw === '' ? 1024 * 1024 * 1024 : 12345)
      await module.close()
    } finally {
      if (previous === undefined) delete process.env.HEALTH_MEMORY_HEAP_BYTES
      else process.env.HEALTH_MEMORY_HEAP_BYTES = previous
    }
  })
})
