import { Body, Controller, Get, Post } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { Test } from '@nestjs/testing'
import { z } from 'zod'

import { createSchemaDto } from './schema-dto'
import { schemaOpenApiConverter } from './schema-openapi'
import { SchemaResponse } from './schema-response'

const LeftDto = createSchemaDto(z.object({ left: z.string() }), 'LeftFactoryDto')
const RightDto = createSchemaDto(
  z.union([
    z.object({ kind: z.literal('text'), right: z.string() }),
    z.object({ kind: z.literal('number'), count: z.number() }),
  ]),
  'RightFactoryDto'
)

// The named factory must retain the discriminated union's branch relationship.
// @ts-expect-error A text branch requires right, not count.
const invalid: InstanceType<typeof RightDto> = { kind: 'text', count: 1 }
void invalid

@Controller('named')
class NamedController {
  @Post()
  @SchemaResponse({ type: LeftDto })
  left(@Body({ schema: LeftDto.schema }) value: InstanceType<typeof LeftDto>) {
    return value
  }

  @Get()
  @SchemaResponse({ type: RightDto })
  right(): InstanceType<typeof RightDto> {
    return { kind: 'text', right: 'valid' }
  }
}

it('keeps distinct direct factory schemas in a real Swagger document', async () => {
  const module = await Test.createTestingModule({ controllers: [NamedController] }).compile()
  const app = module.createNestApplication({ logger: false })
  try {
    await app.init()
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().build(), {
      standardSchemaConverter: schemaOpenApiConverter,
    })
    expect(doc.paths['/named']!.post!.requestBody).toMatchObject({
      content: { 'application/json': { schema: { $ref: '#/components/schemas/LeftFactoryDto' } } },
    })
    expect(doc.paths['/named']!.get!.responses['200']).toMatchObject({
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/RightFactoryDto_Output' } },
      },
    })
    expect(doc.components!.schemas!.LeftFactoryDto).toMatchObject({
      properties: { left: { type: 'string' } },
    })
    expect(doc.components!.schemas!.LeftFactoryDto_Output).toMatchObject(
      doc.components!.schemas!.LeftFactoryDto!
    )
    expect(doc.components!.schemas!.RightFactoryDto_Output).toMatchObject({
      anyOf: [
        { properties: { kind: { enum: ['text'] }, right: { type: 'string' } } },
        { properties: { kind: { enum: ['number'] }, count: { type: 'number' } } },
      ],
    })
    expect(doc.components!.schemas).not.toHaveProperty('Dto_Output')
  } finally {
    await app.close()
  }
})
