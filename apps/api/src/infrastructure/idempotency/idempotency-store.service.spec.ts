import { PinoLogger } from 'nestjs-pino'

import { IdempotencyStoreService } from './idempotency-store.service'

describe('IdempotencyStoreService', () => {
  const logger = { setContext: jest.fn() } as unknown as PinoLogger

  it('returns started for a fresh reservation', async () => {
    const redis = { eval: jest.fn().mockResolvedValue(['started', 'owner']) }
    const service = new IdempotencyStoreService(redis as never, logger)

    await expect(service.reserve('orders', 'key1', 'fp1', 30_000)).resolves.toEqual({
      kind: 'started',
      storageKey: 'idem:v1:orders:key1',
      ownerToken: 'owner',
    })
  })

  it('returns replay for a completed matching fingerprint', async () => {
    const redis = {
      eval: jest
        .fn()
        .mockResolvedValue(['replay', '201', '{"ok":true}', '{"content-type":"application/json"}']),
    }
    const service = new IdempotencyStoreService(redis as never, logger)

    await expect(service.reserve('orders', 'key1', 'fp1', 30_000)).resolves.toEqual({
      kind: 'replay',
      response: {
        status: 201,
        body: '{"ok":true}',
        headers: { 'content-type': 'application/json' },
      },
    })
  })

  it('returns mismatch and conflict states from reserve', async () => {
    const redis = {
      eval: jest.fn().mockResolvedValueOnce(['mismatch']).mockResolvedValueOnce(['conflict']),
    }
    const service = new IdempotencyStoreService(redis as never, logger)

    await expect(service.reserve('orders', 'key1', 'fp1', 30_000)).resolves.toEqual({
      kind: 'mismatch',
    })
    await expect(service.reserve('orders', 'key1', 'fp1', 30_000)).resolves.toEqual({
      kind: 'conflict',
    })
  })

  it('returns false when owner-token conditional complete rejects a stale completion', async () => {
    const redis = { eval: jest.fn().mockResolvedValue(0) }
    const service = new IdempotencyStoreService(redis as never, logger)

    await expect(
      service.complete(
        'idem:v1:orders:key1',
        'owner',
        'fp1',
        { status: 500, body: '{"error":"boom"}', headers: { 'content-type': 'application/json' } },
        86400
      )
    ).resolves.toBe(false)
  })
})
