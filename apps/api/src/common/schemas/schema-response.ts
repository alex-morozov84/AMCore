import { HttpCode, SetMetadata } from '@nestjs/common'
import { ApiResponse } from '@nestjs/swagger'
import { z } from 'zod'

import type { SchemaDto } from './schema-dto.js'

export const RESPONSE_SCHEMA = 'amcore:response-schema'
export const RESPONSE_SCHEMAS_BY_STATUS = 'amcore:response-schemas-by-status'

type Result<D extends SchemaDto | [SchemaDto]> = D extends [SchemaDto<infer S>]
  ? Array<z.input<S>>
  : D extends SchemaDto<infer S>
    ? z.input<S>
    : never

/** One declaration binds return typing, whole-response validation and OpenAPI. */
export function SchemaResponse<D extends SchemaDto | [SchemaDto]>(options: {
  type: D
  status?: number
  description?: string
}) {
  const schema = Array.isArray(options.type) ? z.array(options.type[0].schema) : options.type.schema
  return (
    target: object,
    key: string | symbol,
    descriptor: Pick<
      TypedPropertyDescriptor<(...args: never[]) => Result<D> | Promise<Result<D>>>,
      'value'
    >
  ) => {
    SetMetadata(RESPONSE_SCHEMA, schema)(target, key, descriptor)
    ApiResponse({
      status: options.status ?? 200,
      description: options.description,
      standardSchema: schema,
    })(target, key, descriptor)
    if (options.status !== undefined) HttpCode(options.status)(target, key, descriptor)
  }
}
