import { z } from 'zod'

import type { AiAdapterCall } from '../../src/infrastructure/ai/gateway/ai-gateway.types.js'
import type { ModelGateway } from '../../src/infrastructure/ai/gateway/model-gateway.service.js'
import type { OpenAICompatibleAdapter } from '../../src/infrastructure/ai/gateway/providers/openai-compatible.adapter.js'

/** Compile-only positive and negative checks of the actual public generic inference. */
export async function structuredOutputTypes(
  adapter: OpenAICompatibleAdapter,
  gateway: ModelGateway,
  call: AiAdapterCall
): Promise<void> {
  const schema = z
    .object({ value: z.string().nullable(), optional: z.string().optional() })
    .nullish()
  const result = await adapter.generateObject(call, schema)
  const value: { value: string | null; optional?: string } = result.object
  // @ts-expect-error The whole successful result cannot be null.
  const nullValue: null = result.object
  // @ts-expect-error The whole successful result cannot be undefined.
  const missing: undefined = result.object
  // @ts-expect-error A nullable field cannot be treated as always string.
  const field: string = result.object.value
  const transformed = await gateway.generateObject(
    { messages: [] },
    z.object({ value: z.string() }).transform((v) => v.value)
  )
  const text: string = transformed.object
  // @ts-expect-error Transform output is string, not the schema input object.
  const wrongShape: { value: string } = transformed.object
  const neverNull = await adapter.generateObject(call, z.null())
  const impossible: never = neverNull.object
  const union = await adapter.generateObject(
    call,
    z.union([z.string(), z.number(), z.null(), z.undefined()])
  )
  const unionValue: string | number = union.object
  void [value, nullValue, missing, field, text, wrongShape, impossible, unionValue]
}
