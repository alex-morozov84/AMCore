import { ExecutionContext, StreamableFile } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { firstValueFrom, of } from 'rxjs'
import { z } from 'zod'

import { SchemaResponseInterceptor } from './schema-response.interceptor'

describe('Whole-response schema contract', () => {
  const context = {
    getHandler: () =>
      function handler() {
        return undefined
      },
    getClass: () => class Controller {},
  } as unknown as ExecutionContext
  function serialize(schema: z.ZodType | undefined, value: unknown) {
    const reflector = { getAllAndOverride: () => schema } as unknown as Reflector
    return firstValueFrom(
      new SchemaResponseInterceptor(reflector).intercept(context, { handle: () => of(value) })
    )
  }

  it('validates the whole array and its length', async () => {
    const schema = z.array(z.object({ id: z.string() })).min(2)
    await expect(serialize(schema, [{ id: 'one' }])).rejects.toMatchObject({ status: 500 })
    await expect(
      serialize(schema, [{ id: 'one', secret: 'hidden' }, { id: 'two' }])
    ).resolves.toEqual([{ id: 'one' }, { id: 'two' }])
  })

  it('validates primitive, null, false and undefined values when declared', async () => {
    await expect(
      serialize(
        z.string().transform((s) => s.length),
        'test'
      )
    ).resolves.toBe(4)
    await expect(serialize(z.null(), null)).resolves.toBeNull()
    await expect(serialize(z.boolean(), false)).resolves.toBe(false)
    await expect(serialize(z.string(), null)).rejects.toMatchObject({ status: 500 })
    await expect(serialize(z.string(), undefined)).rejects.toMatchObject({ status: 500 })
  })

  it('applies transforms and stripping without exposing validation payload', async () => {
    await expect(
      serialize(z.object({ id: z.string().transform((s) => s.toUpperCase()) }), {
        id: 'one',
        password: 'hidden',
      })
    ).resolves.toEqual({ id: 'ONE' })
    const error = await serialize(z.object({ id: z.string() }), {
      id: 42,
      password: 'secret-value',
    }).catch((error) => error)
    {
      expect(error).toMatchObject({
        response: { message: 'Response validation failed', errorCode: 'INTERNAL_ERROR' },
      })
      expect(JSON.stringify(error)).not.toContain('secret-value')
      expect(JSON.stringify(error)).not.toContain('invalid_type')
    }
  })

  it('passes through undeclared binary, SSE, manual and 204 responses', async () => {
    const file = new StreamableFile(Buffer.from('binary'))
    expect(await serialize(undefined, file)).toBe(file)
    expect(await serialize(undefined, { data: 'event' })).toEqual({ data: 'event' })
    expect(await serialize(undefined, undefined)).toBeUndefined()
    expect(await serialize(undefined, null)).toBeNull()
  })
})
