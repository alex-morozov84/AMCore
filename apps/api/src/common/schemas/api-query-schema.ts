import { applyDecorators } from '@nestjs/common'
import { ApiQuery } from '@nestjs/swagger'
import { z } from 'zod'

type QuerySchema = Extract<Parameters<typeof ApiQuery>[0], { schema: unknown }>['schema']

/** Document flat query fields when the named request component cannot be expanded by Swagger. */
export function ApiQuerySchema<S extends z.ZodObject>(
  schema: S,
  fields?: readonly (keyof S['shape'] & string)[]
): ReturnType<typeof applyDecorators> {
  const input = z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io: 'input',
    unrepresentable: 'any',
  })
  const required = new Set(input.required)
  const selected = fields && new Set<string>(fields)
  return applyDecorators(
    ...Object.entries(input.properties ?? {})
      .filter(([name]) => !selected || selected.has(name))
      .map(([name, property]) =>
        ApiQuery({
          name,
          required: required.has(name),
          schema: property as QuerySchema,
        })
      )
  )
}
