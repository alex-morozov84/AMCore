import { HttpCode, SetMetadata } from '@nestjs/common'
import { ApiResponse } from '@nestjs/swagger'
import { z } from 'zod'

import type { SchemaDto } from './schema-dto.js'
import { RESPONSE_SCHEMA, RESPONSE_SCHEMAS_BY_STATUS } from './schema-response.js'

interface ResponseVariant {
  type: SchemaDto
  status: number
  description?: string
}
type Variants = [ResponseVariant, ResponseVariant, ...ResponseVariant[]]
type Result<V extends Variants> = z.input<V[number]['type']['schema']>

/** One typed union for serialization; each HTTP outcome has its own precise OpenAPI schema. */
export function SchemaResponses<const V extends Variants>(...variants: V) {
  const schemas = variants.map((variant) => variant.type.schema) as [
    z.ZodType,
    z.ZodType,
    ...z.ZodType[],
  ]
  return (
    target: object,
    key: string | symbol,
    descriptor: Pick<
      TypedPropertyDescriptor<(...args: never[]) => Result<V> | Promise<Result<V>>>,
      'value'
    >
  ) => {
    SetMetadata(RESPONSE_SCHEMA, z.union(schemas))(target, key, descriptor)
    SetMetadata(
      RESPONSE_SCHEMAS_BY_STATUS,
      variants.map((variant) => ({ status: variant.status, schema: variant.type.schema }))
    )(target, key, descriptor)
    for (const variant of variants)
      ApiResponse({
        status: variant.status,
        description: variant.description,
        standardSchema: variant.type.schema,
      })(target, key, descriptor)
    HttpCode(variants[0].status)(target, key, descriptor)
  }
}
