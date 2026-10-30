import { Body, Controller, Get, INestApplication, Post, Res } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { Test } from '@nestjs/testing'
import type { Response } from 'express'
import request from 'supertest'
import { z } from 'zod'

import { createSchemaDto } from './schema-dto'
import { schemaOpenApiConverter } from './schema-openapi'
import { SchemaResponse } from './schema-response'
import { SchemaResponseInterceptor } from './schema-response.interceptor'
import { SchemaResponses } from './schema-responses'
import { createSchemaValidationPipe } from './schema-validation'

class InputDto extends createSchemaDto(z.object({ count: z.coerce.number() })) {}
class OutputDto extends createSchemaDto(z.object({ count: z.number() })) {}
class PendingDto extends createSchemaDto(z.strictObject({ kind: z.literal('pending') })) {}
class TokenDto extends createSchemaDto(z.object({ accessToken: z.string() })) {}

@Controller('fixture')
class FixtureController {
  @Get('wrong-status')
  @SchemaResponses({ type: TokenDto, status: 200 }, { type: PendingDto, status: 202 })
  wrongStatus(@Res({ passthrough: true }) res: Response): TokenDto | PendingDto {
    res.status(202)
    return { accessToken: 'must-not-escape' }
  }
  @Post('partial')
  @SchemaResponses({ type: OutputDto, status: 200 }, { type: PendingDto, status: 202 })
  partial(
    @Body({ schema: InputDto.schema }) input: InputDto,
    @Res({ passthrough: true }) res: Response
  ): OutputDto | PendingDto {
    if (input.count === 0) {
      res.status(202)
      return { kind: 'pending' }
    }
    return { count: input.count }
  }
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

  it('validates both typed outcomes and documents each status without a credential-shaped pending body', async () => {
    await request(app.getHttpServer())
      .post('/fixture/partial')
      .send({ count: 1 })
      .expect(200, { count: 1 })
    await request(app.getHttpServer())
      .post('/fixture/partial')
      .send({ count: 0 })
      .expect(202, { kind: 'pending' })
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build(), {
      standardSchemaConverter: schemaOpenApiConverter,
    })
    const responses = document.paths['/fixture/partial']!.post!.responses
    expect(responses['200']).toMatchObject({
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/OutputDto_Output' } },
      },
    })
    expect(responses['202']).toMatchObject({
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/PendingDto_Output' } },
      },
    })
  })

  it('refuses a token-shaped body under the pending HTTP status', async () => {
    const response = await request(app.getHttpServer()).get('/fixture/wrong-status').expect(500)
    expect(response.body.message).toBe('Response validation failed')
    expect(JSON.stringify(response.body)).not.toContain('must-not-escape')
  })
})
