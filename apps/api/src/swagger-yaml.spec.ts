import { createRequire } from 'node:module'
import { resolve } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { type OpenAPIObject, SwaggerModule } from '@nestjs/swagger'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { buildSwaggerConfig } from './swagger.config'

const nativeRequire = createRequire(resolve(process.cwd(), 'package.json'))
const swaggerRequire = createRequire(nativeRequire.resolve('@nestjs/swagger'))
const yaml = swaggerRequire('js-yaml') as { load: (source: string) => unknown }

describe('Swagger YAML serialization', () => {
  let app: INestApplication
  let document: OpenAPIObject

  beforeAll(async () => {
    const module = await Test.createTestingModule({}).compile()
    app = module.createNestApplication()
    document = {
      ...buildSwaggerConfig(),
      openapi: '3.0.0',
      paths: {
        '/files/{id}': {
          get: {
            security: [{ bearer: [] }, { apiKeyBearer: [] }],
            responses: { '200': { description: 'File: ready #1\nSecond line' } },
          },
        },
      },
    }
    SwaggerModule.setup('docs', app, document, { ui: false })
    await app.init()
  })

  afterAll(async () => {
    await app?.close()
  })

  it('serves the same document and security schemes as JSON', async () => {
    const json = await request(app.getHttpServer()).get('/docs-json').expect(200)
    const serialized = await request(app.getHttpServer()).get('/docs-yaml').expect(200)
    expect(yaml.load(serialized.text)).toEqual(json.body)
    expect(json.body).toEqual(document)
    expect(json.body.components.securitySchemes).toHaveProperty('apiKeyBearer')
  })
})
