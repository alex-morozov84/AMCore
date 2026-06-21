import type { WebhookVerificationInput } from './webhook.types'
import { WebhookProviderService } from './webhook-provider.service'

import type { EnvService } from '@/env/env.service'

function makeService(secrets: Record<string, string>): {
  service: WebhookProviderService
  stripe: { verify: jest.Mock }
  generic: { verify: jest.Mock }
  telegram: { verify: jest.Mock }
} {
  const env = {
    get: jest.fn((key: string) => (key === 'WEBHOOK_SECRETS' ? secrets : undefined)),
  } as unknown as EnvService
  const stripe = { verify: jest.fn(() => ({ ok: true })) }
  const generic = { verify: jest.fn(() => ({ ok: true })) }
  const telegram = { verify: jest.fn(() => ({ ok: true })) }
  const service = new WebhookProviderService(
    env,
    stripe as never,
    generic as never,
    telegram as never
  )
  return { service, stripe, generic, telegram }
}

const input = { headers: {}, rawBody: Buffer.from('{}'), secret: 's', now: 0, toleranceSeconds: 0 }

describe('WebhookProviderService', () => {
  describe('telegram', () => {
    it('selects the configured WEBHOOK_SECRETS.telegram secret', () => {
      const { service } = makeService({ telegram: 'tg-secret', stripe: 'whsec' })
      const resolved = service.resolve('telegram')
      expect(resolved.provider).toBe('telegram')
      expect(resolved.secret).toBe('tg-secret')
    })

    it('returns undefined replayId — durable DB dedupe owns it, Redis is a no-op', () => {
      const { service } = makeService({ telegram: 'tg-secret' })
      const resolved = service.resolve('telegram')
      expect(
        resolved.replayId({ 'x-telegram-bot-api-secret-token': 'tg' }, { update_id: 1 })
      ).toBeUndefined()
    })

    it('routes verification through the Telegram verifier, never the generic HMAC adapter', () => {
      const { service, telegram, generic, stripe } = makeService({ telegram: 'tg-secret' })
      service.resolve('telegram').verify(input as WebhookVerificationInput)
      expect(telegram.verify).toHaveBeenCalledTimes(1)
      expect(generic.verify).not.toHaveBeenCalled()
      expect(stripe.verify).not.toHaveBeenCalled()
    })
  })

  describe('regression — other providers still route correctly', () => {
    it('stripe → stripe verifier + body-id replayId', () => {
      const { service, stripe, telegram } = makeService({ stripe: 'whsec' })
      const resolved = service.resolve('stripe')
      resolved.verify(input as WebhookVerificationInput)
      expect(stripe.verify).toHaveBeenCalledTimes(1)
      expect(telegram.verify).not.toHaveBeenCalled()
      expect(resolved.replayId({}, { id: 'evt_1' })).toBe('evt_1')
    })

    it('generic → generic verifier + header replayId', () => {
      const { service, generic, telegram } = makeService({ generic: 'gen' })
      const resolved = service.resolve('generic')
      resolved.verify(input as WebhookVerificationInput)
      expect(generic.verify).toHaveBeenCalledTimes(1)
      expect(telegram.verify).not.toHaveBeenCalled()
      expect(resolved.replayId({ 'webhook-id': 'wid_1' }, {})).toBe('wid_1')
    })
  })
})
