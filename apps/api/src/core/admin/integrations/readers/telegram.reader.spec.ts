import type { PinoLogger } from 'nestjs-pino'

import type { EnvService } from '../../../../env/env.service'
import type { AppRedisClient } from '../../../../infrastructure/redis'
import type { NotificationChannelRegistry } from '../../../notifications/channels/notification-channel.registry'
import { telegramCheckBinding } from '../../../notifications/channels/telegram/telegram-reachability.binding'

import { TelegramIntegrationReader } from './telegram.reader'

const TOKEN = '123456:secret-token-value'
const BASE = 'https://api.telegram.org'

function setup(opts: { registered?: boolean; token?: string; reply?: unknown } = {}) {
  const { registered = true, token = TOKEN, reply } = opts
  const channels = {
    available: jest.fn(() => {
      if (!registered) throw new Error('not registered')
      return Boolean(token)
    }),
  } as unknown as NotificationChannelRegistry
  const env = {
    get: (key: string) =>
      key === 'TELEGRAM_BOT_TOKEN' ? token : key === 'TELEGRAM_API_BASE_URL' ? BASE : undefined,
  } as unknown as EnvService
  const evalCommand = jest.fn(() => Promise.resolve(reply))
  const redis = {
    isReady: true,
    withCommandOptions: () => ({ eval: evalCommand }),
  } as unknown as AppRedisClient
  const logger = { setContext: jest.fn(), warn: jest.fn() } as unknown as PinoLogger
  return { reader: new TelegramIntegrationReader(channels, env, redis, logger), evalCommand }
}

describe('TelegramIntegrationReader', () => {
  it('a channel that is not composed is disabled and reads nothing', async () => {
    const { reader, evalCommand } = setup({ registered: false })
    await expect(reader.read()).resolves.toMatchObject({ configuration: 'disabled' })
    expect(evalCommand).not.toHaveBeenCalled()
  })

  it('no token is not configured and reads nothing', async () => {
    const { reader, evalCommand } = setup({ token: '' })
    const reading = await reader.read()
    expect(reading).toMatchObject({ configuration: 'not_configured', links: [] })
    expect(reading.evidence.scope).toBe('configuration_only')
    expect(evalCommand).not.toHaveBeenCalled()
  })

  it('an unanswered read makes only this row unreadable, never ok', async () => {
    const { reader } = setup({ reply: undefined })
    await expect(reader.read()).rejects.toThrow('telegram_check_unavailable')
  })

  it('reports the workers result for its own settings, with the guide link and no secret', async () => {
    const now = Date.now()
    const stored = {
      v: 1,
      binding: telegramCheckBinding(TOKEN, BASE),
      observedAt: now - 5_000,
      seq: 1,
      result: 'failed',
      failure: 'auth_rejected',
    }
    const { reader } = setup({ reply: [String(now), '', 'w1', JSON.stringify(stored)] })
    const reading = await reader.read()
    expect(reading).toMatchObject({
      configuration: 'configured',
      links: ['runbook'],
      evidence: { result: 'failed', instance: 'workers', failure: 'auth_rejected' },
    })
    expect(JSON.stringify(reading)).not.toContain(TOKEN)
  })
})
