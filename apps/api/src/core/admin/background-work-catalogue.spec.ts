import { BackgroundWorkCatalogue } from './background-work-catalogue'

import { AppException } from '@/common/exceptions'
import { defineDurableWork } from '@/infrastructure/background-work/work-definition'

describe('Registration catalogue encoded capacity', () => {
  it('keeps an existing six-counter durable registration available', async () => {
    const definition = defineDurableWork({ id: 'legacy-work', definitionVersion: 1 })
    const count = (value: number) => ({ value, truncated: false })
    const counts = {
      pending: count(0),
      due: count(0),
      processing: count(0),
      failed: count(2),
      terminal: count(5),
      unresolved: count(0),
    }
    const tx = { $queryRaw: async () => [{ now: new Date() }] }
    const args = [
      [{ definition }],
      new Map(),
      {
        get: () => ({
          readSummary: async () => ({
            id: definition.id,
            kind: 'durable',
            definitionVersion: 1,
            status: 'available',
            sampledAt: new Date().toISOString(),
            capabilities: [],
            counts,
          }),
        }),
      },
      { $transaction: async (action: (value: typeof tx) => Promise<unknown>) => action(tx) },
      {},
      { assert: async () => undefined },
      { lock: async () => [], request: async () => undefined },
    ] as unknown as ConstructorParameters<typeof BackgroundWorkCatalogue>
    const [summary] = await new BackgroundWorkCatalogue(...args).list({ sub: 'actor' } as never)
    expect(summary?.status).toBe('available')
    expect(summary?.counts?.terminal.value).toBe(5)
    expect(summary?.counts?.completed).toBeUndefined()
  })

  it('refuses the complete oversized catalogue with closed 503 rather than hiding entries', async () => {
    const definitions = Array.from({ length: 64 }, (_, i) =>
      defineDurableWork({
        id: `work-${i}`,
        definitionVersion: 1,
        presentation: {
          name: { en: 'Work' },
          fields: Object.fromEntries(
            Array.from({ length: 8 }, (_, field) => [
              String(field),
              {
                en: '"'.repeat(80),
                ru: '😀'.repeat(40),
                de: 'x'.repeat(80),
              },
            ])
          ),
        },
      })
    )
    const get = jest.fn((token: symbol) => ({
      readSummary: async () => ({
        id: definitions.find((definition) => definition.tokens.reader === token)!.id,
        kind: 'durable',
        definitionVersion: 1,
        status: 'available',
        sampledAt: new Date().toISOString(),
        capabilities: [],
      }),
    }))
    const tx = { $queryRaw: async () => [{ now: new Date() }] }
    const request = jest.fn()
    const args = [
      definitions.map((definition) => ({ definition })),
      new Map(),
      { get },
      { $transaction: async (action: (value: typeof tx) => Promise<unknown>) => action(tx) },
      {},
      { assert: async () => undefined },
      { lock: async () => [], request },
    ] as unknown as ConstructorParameters<typeof BackgroundWorkCatalogue>
    const service = new BackgroundWorkCatalogue(...args)
    const failure = await service
      .list({ sub: 'actor' } as Parameters<typeof service.list>[0])
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(AppException)
    expect((failure as AppException).getStatus()).toBe(503)
    expect((failure as AppException).getResponse()).toMatchObject({ errorCode: 'WORK_UNAVAILABLE' })
    expect(get).toHaveBeenCalledTimes(64)
    expect(request).toHaveBeenCalledTimes(1)
  })
})
