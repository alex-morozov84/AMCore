import type { ExecutionContext } from '@nestjs/common'

import type { GcraRedisLimiter } from '../../infrastructure/throttling/gcra-redis-limiter.service'

import type { InvitationContinuationService } from './invitation-continuation.service'
import { InvitationRequestGuard } from './invitation-request.guard'

describe('invitation admission order', () => {
  const request = {
    originalUrl: '/api/v1/auth/invites/register',
    path: '/api/v1/auth/invites/register',
    method: 'POST',
    headers: { 'x-invitation-continuation': 'fake-continuation' },
    params: {},
    ip: '127.0.0.1',
  }
  const execution = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext

  it.each([0, 1])(
    'denies exhausted budget %s before reading invitation context',
    async (denied) => {
      const consume = jest.fn().mockResolvedValue({ allowed: true })
      consume.mockResolvedValueOnce({ allowed: denied !== 0, retryAfterMs: 1000 })
      if (denied === 1) consume.mockResolvedValueOnce({ allowed: false, retryAfterMs: 1000 })
      const context = jest.fn()
      const guard = new InvitationRequestGuard(
        { consume } as unknown as GcraRedisLimiter,
        { context } as unknown as InvitationContinuationService
      )

      await expect(guard.canActivate(execution)).rejects.toMatchObject({ status: 429 })
      expect(context).not.toHaveBeenCalled()
    }
  )

  it('uses hashed continuation and canonical email keys', async () => {
    const order: string[] = []
    const consume = jest.fn(async (key: string) => {
      order.push(key.split(':')[0]!)
      return { allowed: true }
    })
    const context = jest.fn(async () => {
      order.push('context')
      return { email: 'person@example.test' }
    })
    const guard = new InvitationRequestGuard(
      { consume } as unknown as GcraRedisLimiter,
      { context } as unknown as InvitationContinuationService
    )

    await expect(guard.canActivate(execution)).resolves.toBe(true)
    expect(order).toEqual([
      'invite-continuation',
      'invite-register-ip',
      'context',
      'invite-register-email',
    ])
    expect(JSON.stringify(consume.mock.calls)).not.toContain('fake-continuation')
    expect(JSON.stringify(consume.mock.calls)).not.toContain('person@example.test')
  })
})
