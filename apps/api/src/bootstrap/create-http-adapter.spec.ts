import { createHttpAdapter } from './create-http-adapter'

describe('createHttpAdapter', () => {
  // nestjs-cls detects Fastify by this exact constructor name. A subclass with another name makes
  // it mount the correlation-ID middleware on `/` only, so real requests silently get no ID.
  it('keeps the constructor name nestjs-cls uses to detect Fastify', () => {
    expect(createHttpAdapter().constructor.name).toBe('FastifyAdapter')
  })
})
