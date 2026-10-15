import { z } from 'zod'

import { gate, structuredFixture } from '../../../../../test/fixtures/ai-structured-output.js'
import { providerReceipt } from '../provider-receipt.js'

/** Root-nullish rejection is intentional; nested optional/nullable data stays schema-owned. */
describe('modern structured output contract', () => {
  it.each<[string, string, z.ZodType<unknown>, unknown]>([
    ['object', '{"value":"ok"}', z.object({ value: z.string() }), { value: 'ok' }],
    [
      'nullable/optional fields',
      '{"value":null}',
      z.object({ value: z.string().nullable(), optional: z.string().optional() }),
      { value: null },
    ],
    [
      'nullable root non-null branch',
      '{"value":"ok"}',
      z.object({ value: z.string() }).nullable(),
      { value: 'ok' },
    ],
    ['array', '["ok"]', z.array(z.string()), ['ok']],
    ['scalar', '42', z.number(), 42],
    ['union', '"ok"', z.union([z.string(), z.number()]), 'ok'],
    [
      'transformation',
      '{"value":"ok"}',
      z.object({ value: z.string() }).transform((v) => v.value),
      'ok',
    ],
  ])('retains %s', async (_name, content, schema, expected) => {
    const f = structuredFixture(content)
    const result = await f.adapter.generateObject(f.call, schema)
    expect(result.object).toEqual(expected)
    expect(result.receipt?.usage.totalTokens).toBe(12)
    expect(f.requests).toHaveLength(1)
    expect(f.requests[0]?.redirect).toBe('error')
  })

  it.each<[string, string | null, z.ZodType<unknown>]>([
    ['null', 'null', z.null()],
    ['nullable root null', 'null', z.object({ value: z.string() }).nullable()],
    [
      'transformed undefined',
      '{"value":"ok"}',
      z.object({ value: z.string() }).transform(() => undefined),
    ],
    ['malformed', '{', z.object({ value: z.string() })],
    ['schema mismatch', '{"value":42}', z.object({ value: z.string() })],
    ['missing content', null, z.object({ value: z.string() })],
    ['empty content', '', z.object({ value: z.string() })],
  ])('rejects %s without losing usage', async (_name, content, schema) => {
    const f = structuredFixture(content)
    const failure = await f.adapter.generateObject(f.call, schema).catch((e: unknown) => e)
    expect(failure).toMatchObject({ code: 'output_validation_failed', retryable: false })
    expect(providerReceipt(failure)?.usage.totalTokens).toBe(12)
    expect(f.requests).toHaveLength(1)
  })

  it.each(['content_filter', 'length'])('classifies invalid %s finish', async (finish) => {
    const f = structuredFixture('', finish)
    const failure = await f.adapter
      .generateObject(f.call, z.object({ value: z.string() }))
      .catch((e: unknown) => e)
    expect(failure).toMatchObject({
      code: finish === 'content_filter' ? 'content_filtered' : 'output_validation_failed',
      retryable: false,
    })
    expect(providerReceipt(failure)?.usage.totalTokens).toBe(12)
  })

  it('accepts valid length-limited output', async () => {
    const f = structuredFixture('{"value":"ok"}', 'length')
    expect(
      (await f.adapter.generateObject(f.call, z.object({ value: z.string() }))).object
    ).toEqual({ value: 'ok' })
  })

  it.each(['success', 'reject', 'cancel', 'timeout', 'cancel-reject'])(
    'settles finite async validation: %s',
    async (mode) => {
      const started = gate()
      const release = gate()
      const f = structuredFixture('{"value":"ok"}')
      const controller = new AbortController()
      f.call.abortSignal = controller.signal
      if (mode === 'timeout') f.call.timeoutMs = 30
      const schema = z.object({ value: z.string() }).superRefine(async (_value, context) => {
        started.release()
        await release.promise
        if (mode.endsWith('reject')) context.addIssue({ code: 'custom' })
      })
      const pending = f.adapter.generateObject(f.call, schema).then(
        (value) => ({ value, failure: undefined }),
        (failure: unknown) => ({ value: undefined, failure })
      )
      await started.promise
      if (mode.startsWith('cancel')) controller.abort()
      if (mode === 'timeout') {
        const signal = f.requests[0]?.signal
        if (!signal) throw new Error('No SDK request signal')
        if (!signal.aborted)
          await new Promise<void>((resolve) =>
            signal.addEventListener('abort', () => resolve(), { once: true })
          )
      }
      release.release()
      const result = await pending
      const expected =
        mode === 'success'
          ? { value: { object: { value: 'ok' } }, failure: undefined }
          : {
              value: undefined,
              failure: {
                code: mode.startsWith('cancel')
                  ? 'aborted'
                  : mode === 'timeout'
                    ? 'provider_timeout'
                    : 'output_validation_failed',
              },
            }
      expect(result).toMatchObject(expected)
      const receipt = result.value?.receipt ?? providerReceipt(result.failure)
      expect(receipt?.usage.totalTokens).toBe(12)
      expect(f.requests).toHaveLength(1)
    }
  )
})
