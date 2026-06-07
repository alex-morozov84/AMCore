import { AuditActorType } from '@prisma/client'
import type { ClsService } from 'nestjs-cls'
import type { PinoLogger } from 'nestjs-pino'

import { createMockContext, mockContextToPrisma } from '../auth/test-context'

import { AuditLogService } from './audit-log.service'

describe('AuditLogService fail-open path', () => {
  it('swallows non-transactional write failures and logs a warning', async () => {
    const mockCtx = createMockContext()
    const cls = {
      get: jest.fn(),
      getId: jest.fn(() => 'req-1'),
    } as unknown as jest.Mocked<ClsService>
    const logger = {
      setContext: jest.fn(),
      warn: jest.fn(),
    } as unknown as jest.Mocked<Pick<PinoLogger, 'setContext' | 'warn'>>
    mockCtx.prisma.auditLog.create.mockRejectedValue(new Error('db down'))

    const service = new AuditLogService(mockContextToPrisma(mockCtx), cls, logger as never)

    await expect(
      service.record({
        action: 'auth.step_up_failed',
        actorType: AuditActorType.SYSTEM,
        metadata: { password: 'hidden', reason: 'invalid_password' },
      })
    ).resolves.toBeUndefined()

    expect(logger.warn).toHaveBeenCalledWith(
      { action: 'auth.step_up_failed', err: 'db down' },
      'Failed to persist audit log'
    )
  })
})
