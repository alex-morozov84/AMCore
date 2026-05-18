import { paginationQuerySchema } from '@amcore/shared'

describe('paginationQuerySchema (OA-08)', () => {
  describe('happy path', () => {
    it('parses string values via coercion', () => {
      expect(paginationQuerySchema.parse({ page: '2', limit: '50' })).toEqual({
        page: 2,
        limit: 50,
      })
    })

    it('applies defaults when fields are missing', () => {
      expect(paginationQuerySchema.parse({})).toEqual({ page: 1, limit: 20 })
    })

    it.each([
      ['page=1, limit=1', { page: 1, limit: 1 }],
      ['page=1, limit=100', { page: 1, limit: 100 }],
    ])('accepts boundary input %s', (_label, input) => {
      expect(() => paginationQuerySchema.parse(input)).not.toThrow()
    })
  })

  describe('rejections', () => {
    it.each([
      ['?page=abc', { page: 'abc' }],
      ['?page=0', { page: 0 }],
      ['?page=-1', { page: -1 }],
      ['?page=1.5', { page: 1.5 }],
      ['?limit=abc', { limit: 'abc' }],
      ['?limit=0', { limit: 0 }],
      ['?limit=-5', { limit: -5 }],
      ['?limit=101', { limit: 101 }],
      ['?limit=999', { limit: 999 }],
    ])('rejects %s', (_label, input) => {
      expect(() => paginationQuerySchema.parse(input)).toThrow()
    })
  })
})
