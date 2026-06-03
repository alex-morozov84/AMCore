import type { INestApplication } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { ShutdownService } from './shutdown.service'

describe('ShutdownService', () => {
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  } as unknown as PinoLogger

  let exitSpy: jest.SpyInstance<never, [code?: string | number | null]>
  let originalExitCode: string | number | null | undefined

  beforeEach(() => {
    jest.clearAllMocks()
    originalExitCode = process.exitCode
    process.exitCode = undefined
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit should not be called from shutdown hook')
    }) as never)
  })

  afterEach(() => {
    exitSpy.mockRestore()
    process.exitCode = originalExitCode
  })

  it('flushes logs without forcing process exit', () => {
    const app = { flushLogs: jest.fn() } as unknown as INestApplication
    const service = new ShutdownService(logger)
    service.setApp(app)

    service.onApplicationShutdown('SIGTERM')

    expect(app.flushLogs).toHaveBeenCalledTimes(1)
    expect(exitSpy).not.toHaveBeenCalled()
    expect(process.exitCode).toBeUndefined()
  })

  it('marks a failed log flush via exitCode without forcing process exit', () => {
    const app = {
      flushLogs: jest.fn(() => {
        throw new Error('flush failed')
      }),
    } as unknown as INestApplication
    const service = new ShutdownService(logger)
    service.setApp(app)

    service.onApplicationShutdown('SIGTERM')

    expect(exitSpy).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })
})
