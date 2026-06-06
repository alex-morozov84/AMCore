import { Reflector } from '@nestjs/core'

import { WebhookGuard } from './webhook.guard'

describe('WebhookGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  } as unknown as Reflector

  it('returns 400 when the provider secret is missing', async () => {
    reflector.getAllAndOverride = jest.fn().mockReturnValue('stripe')
    const env = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'WEBHOOK_SECRETS') return {}
        return 300
      }),
    }
    const providers = { resolve: jest.fn().mockReturnValue({ secret: undefined }) }
    const replay = { checkAndMark: jest.fn() }
    const guard = new WebhookGuard(reflector, env as never, providers as never, replay as never)

    await expect(canActivate(guard)).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: 'WEBHOOK_CONFIGURATION_MISSING' }),
      status: 400,
    })
  })

  it('rejects a replay after successful signature verification', async () => {
    reflector.getAllAndOverride = jest.fn().mockReturnValue('stripe')
    const env = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'WEBHOOK_SECRETS') return { stripe: 'whsec' }
        return 300
      }),
    }
    const providers = {
      resolve: jest.fn().mockReturnValue({
        secret: 'whsec',
        verify: () => ({ ok: true }),
        replayId: () => 'evt_1',
      }),
    }
    const replay = { checkAndMark: jest.fn().mockResolvedValue(false) }
    const guard = new WebhookGuard(reflector, env as never, providers as never, replay as never)

    await expect(canActivate(guard)).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: 'WEBHOOK_REPLAY_REJECTED' }),
      status: 401,
    })
  })
})

function canActivate(guard: WebhookGuard): Promise<boolean> {
  return guard.canActivate({
    getHandler: () => null,
    getClass: () => null,
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { 'stripe-signature': 't=1,v1=abc' },
        rawBody: Buffer.from('{}'),
        body: { id: 'evt_1' },
      }),
    }),
  } as never)
}
