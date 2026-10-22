import { describe, expect, it } from 'vitest'

import { productAdminConfigSchema, productAdminReturnSchema } from '../schemas/frontend-context'

import {
  parseProductAdminReturn,
  productAdminPath,
  productAdminReturnPath,
} from './product-admin-paths'

describe('product administration destinations', () => {
  it.each(['//elsewhere', '/a//b', '/a/', 'https://elsewhere.example'])(
    'rejects a network or ambiguous suffix: %s',
    (suffix) => {
      expect(() =>
        productAdminPath(suffix, { version: 1, mode: 'host', alias: 'office' })
      ).toThrow()
    }
  )

  it('validates explicit placement before building a redirect destination', () => {
    expect(() => productAdminPath('', { version: 1, mode: 'path', alias: '/elsewhere' })).toThrow()
  })

  it('keeps source alias physical while host public routes start at root', () => {
    expect(productAdminPath('/login', { version: 1, mode: 'path', alias: 'office' })).toBe(
      '/office/login'
    )
    expect(productAdminPath('/login', { version: 1, mode: 'host', alias: 'office' })).toBe('/login')
    expect(productAdminPath('', { version: 1, mode: 'host', alias: 'office' })).toBe('/')
  })

  it.each(['../admin', 'Office', 'a/b', 'a%2fb', '', 'x'.repeat(33)])(
    'rejects malformed source segments: %s',
    (alias) => {
      expect(productAdminConfigSchema.safeParse({ version: 1, mode: 'path', alias }).success).toBe(
        false
      )
    }
  )

  it.each([
    JSON.stringify({ page: 'login' }),
    JSON.stringify({ page: 'members' }),
    JSON.stringify({ page: 'organizations', origin: 'https://elsewhere.example' }),
    JSON.stringify({ page: 'organizations', query: { token: 'secret' } }),
    JSON.stringify({ page: 'organizations', query: { page: -1 } }),
    'https://elsewhere.example',
    'x'.repeat(1025),
    ['duplicate', 'return'],
  ])('discards unsafe or ambiguous return input: %j', (input) => {
    expect(parseProductAdminReturn(input)).toBeUndefined()
  })

  it('renders only semantic, reauthorizable routes and bounded queries', () => {
    const target = productAdminReturnSchema.parse({
      page: 'organizations',
      query: { view: 'list', page: 2 },
    })
    expect(productAdminReturnPath(target)).toBe('/manage/organizations?page=2&view=list')
  })
})
