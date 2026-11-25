import type { StandardSchemaConverter } from '@nestjs/swagger'
import { z } from 'zod'

import { schemaNames } from './schema-dto.js'

/** Stable DTO component names preserve existing input/output OpenAPI references. */
export const schemaOpenApiConverter: StandardSchemaConverter = (candidate, { schemaType }) => {
  if (!(candidate instanceof z.ZodType)) return undefined
  const schema = z.toJSONSchema(candidate, {
    target: 'openapi-3.0',
    io: schemaType,
    unrepresentable: 'any',
  })
  const name = schemaNames.get(candidate)
  if (!name) return { schema }
  const component = schemaType === 'output' ? `${name}_Output` : name
  const { definitions, ...root } = schema
  const ownedDefinition = (key: string): string => `${component}__${key}`
  const components = {
    [component]: root,
    ...Object.fromEntries(
      Object.entries(definitions ?? {}).map(([key, value]) => [ownedDefinition(key), value])
    ),
  }

  return {
    schema: { $ref: `#/components/schemas/${component}` },
    components: definitions
      ? JSON.parse(
          JSON.stringify(components, (key, value: unknown) =>
            key === '$ref' && typeof value === 'string' && value.startsWith('#/definitions/')
              ? `#/components/schemas/${ownedDefinition(value.slice('#/definitions/'.length))}`
              : value
          )
        )
      : components,
  }
}
