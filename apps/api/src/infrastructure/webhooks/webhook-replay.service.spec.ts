import { PinoLogger } from 'nestjs-pino'

import { WebhookReplayService } from './webhook-replay.service'

describe('WebhookReplayService', () => {
  const logger = { setContext: jest.fn(), warn: jest.fn() } as unknown as PinoLogger

  it('marks the first event id and rejects duplicates', async () => {
    const redis = {
      set: jest.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce(null),
    }
    const service = new WebhookReplayService(redis as never, logger)

    await expect(service.checkAndMark('stripe', 'evt_1', 300)).resolves.toBe(true)
    await expect(service.checkAndMark('stripe', 'evt_1', 300)).resolves.toBe(false)
  })

  it('fails open when Redis is unavailable', async () => {
    const redis = { set: jest.fn().mockRejectedValue(new Error('redis down')) }
    const service = new WebhookReplayService(redis as never, logger)

    await expect(service.checkAndMark('stripe', 'evt_1', 300)).resolves.toBe(true)
    expect(redis.set).toHaveBeenCalledTimes(1)
  })
})
