import { z } from 'zod'

import { createSchemaDto } from './schema-dto'
import {
  createSchemaValidationPipe,
  SchemaValidationException,
  validationException,
} from './schema-validation'

describe('Native schema validation contract', () => {
  const pipe = createSchemaValidationPipe()

  it('coerces query values, applies defaults and strips extra input', async () => {
    class QueryDto extends createSchemaDto(z.object({ page: z.coerce.number().default(1) })) {}
    expect(
      await pipe.transform({ page: '2', ignored: true }, { type: 'query', schema: QueryDto.schema })
    ).toEqual({ page: 2 })
    expect(await pipe.transform({}, { type: 'query', schema: QueryDto.schema })).toEqual({
      page: 1,
    })
  })

  it('normalizes Standard Schema key segments without exposing raw input', () => {
    const exception = validationException([
      { message: 'Invalid', path: [{ key: 'rows' }, 2, { key: 'name' }] },
    ])
    expect(exception.getResponse()).toEqual({
      statusCode: 400,
      message: 'Validation failed',
      errors: [
        { path: ['rows', 2, 'name'], message: 'Invalid', code: undefined, params: undefined },
      ],
    })
  })

  it('retains nested and root paths, issue codes and custom errorCode', async () => {
    const schema = z
      .object({ rows: z.array(z.object({ name: z.string() })) })
      .superRefine((_, ctx) => {
        ctx.addIssue({
          code: 'custom',
          message: 'Rejected',
          params: { errorCode: 'fixture', secret: 'hidden' },
        })
      })
    await expect(
      pipe.transform({ rows: [{ name: 42 }] }, { type: 'body', schema })
    ).rejects.toMatchObject({
      response: { errors: [{ path: ['rows', 0, 'name'], code: 'invalid_type' }] },
    })
    const error = await pipe
      .transform({ rows: [{ name: 'secret-input' }] }, { type: 'body', schema })
      .catch((error) => error)
    {
      expect(error).toMatchObject({
        response: { errors: [{ path: [], code: 'custom', params: { errorCode: 'fixture' } }] },
      })
      expect(JSON.stringify(error)).not.toContain('secret-input')
      expect(JSON.stringify(error)).not.toContain('hidden')
    }
  })

  it('retains manual-validation transport and rejects unions', async () => {
    const result = z.string().safeParse(42)
    if (result.success) throw new Error('Expected invalid fixture')
    expect(new SchemaValidationException(result.error).getStatus()).toBe(400)
    await expect(
      pipe.transform(true, { type: 'body', schema: z.union([z.string(), z.number()]) })
    ).rejects.toMatchObject({ response: { errors: [{ code: 'invalid_union' }] } })
  })

  it('does not validate parameters without a schema or custom decorators', async () => {
    expect(await pipe.transform('raw', { type: 'param' })).toBe('raw')
    expect(await pipe.transform('raw', { type: 'custom', schema: z.number() })).toBe('raw')
  })
})
