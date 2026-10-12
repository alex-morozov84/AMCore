import { Body, Controller, Get, INestApplication, Post } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { z } from 'zod'

import { createSchemaDto } from './schema-dto'
import { schemaOpenApiConverter } from './schema-openapi'
import { SchemaResponse } from './schema-response'
import { SchemaResponseInterceptor } from './schema-response.interceptor'
import { createSchemaValidationPipe } from './schema-validation'

class InputDto extends createSchemaDto(z.object({ count: z.coerce.number() })) {}
class OutputDto extends createSchemaDto(z.object({ count: z.number() })) {}

@Controller('fixture')
class FixtureController {
  @Post()
  @SchemaResponse({ type: OutputDto, status: 201 })
  create(@Body({ schema: InputDto.schema }) input: InputDto) {
    return { count: input.count, secret: 'must-strip' }
  }

  @Get('invalid')
  @SchemaResponse({ type: OutputDto })
  invalid(): OutputDto {
    return { count: 'bad-output' } as unknown as OutputDto
  }
}

describe('Native route schemas and OpenAPI', () => {
  let app: INestApplication
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [FixtureController],
      providers: [SchemaResponseInterceptor],
    }).compile()
    app = module.createNestApplication({ logger: false })
    app.useGlobalPipes(createSchemaValidationPipe())
    app.useGlobalInterceptors(module.get(SchemaResponseInterceptor, { strict: false }))
    await app.init()
  })
  afterAll(async () => {
    await app?.close()
  })

  it('validates native metadata and strips response fields in a real HTTP app', async () => {
    await request(app.getHttpServer())
      .post('/fixture')
      .send({ count: '2' })
      .expect(201, { count: 2 })
    const response = await request(app.getHttpServer())
      .post('/fixture')
      .send({ count: 'invalid' })
      .expect(400)
    expect(response.body).toMatchObject({
      message: 'Validation failed',
      errors: [{ path: ['count'], code: 'invalid_type' }],
    })
  })

  it('returns a safe serialization failure', async () => {
    const response = await request(app.getHttpServer()).get('/fixture/invalid').expect(500)
    expect(response.body.message).toBe('Response validation failed')
    expect(JSON.stringify(response.body)).not.toContain('bad-output')
  })

  it('uses distinct stable input and output component references', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build(), {
      standardSchemaConverter: schemaOpenApiConverter,
    })
    const operation = document.paths['/fixture']!.post!
    expect(operation.requestBody).toMatchObject({
      content: { 'application/json': { schema: { $ref: '#/components/schemas/InputDto' } } },
    })
    expect(operation.responses['201']).toMatchObject({
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/OutputDto_Output' } },
      },
    })
    expect(document.components!.schemas!.OutputDto_Output).toMatchObject({
      properties: { count: { type: 'number' } },
    })
  })
})
