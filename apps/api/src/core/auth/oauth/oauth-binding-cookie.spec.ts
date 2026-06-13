import type { Request, Response } from 'express'

import {
  clearOAuthBindingCookie,
  readOAuthBindingNonce,
  setOAuthBindingCookie,
} from './oauth-binding-cookie'

const APPLE_PATH = '/api/v1/auth/oauth/apple/callback'

function mockRes(): Response & {
  cookie: jest.Mock
  clearCookie: jest.Mock
} {
  return { cookie: jest.fn(), clearCookie: jest.fn() } as unknown as Response & {
    cookie: jest.Mock
    clearCookie: jest.Mock
  }
}

function mockReq(cookies: Record<string, string>): Request {
  return { cookies } as unknown as Request
}

describe('oauth-binding-cookie', () => {
  describe('setOAuthBindingCookie', () => {
    it('sets a SameSite=Lax root cookie for redirect providers', () => {
      const res = mockRes()
      setOAuthBindingCookie(res, 'google', 'nonce-1', true)

      expect(res.cookie).toHaveBeenCalledWith(
        'oauth_state',
        'nonce-1',
        expect.objectContaining({ sameSite: 'lax', path: '/', httpOnly: true, secure: true })
      )
    })

    it('sets a SameSite=None path-scoped cookie for Apple (form_post)', () => {
      const res = mockRes()
      setOAuthBindingCookie(res, 'apple', 'nonce-2', true)

      expect(res.cookie).toHaveBeenCalledWith(
        'oauth_state_apple',
        'nonce-2',
        expect.objectContaining({
          sameSite: 'none',
          path: APPLE_PATH,
          httpOnly: true,
          secure: true,
        })
      )
    })

    it('always sets Secure on the Apple cookie, even when not in production', () => {
      // SameSite=None requires Secure regardless of NODE_ENV — a None cookie
      // without Secure is rejected by browsers.
      const res = mockRes()
      setOAuthBindingCookie(res, 'apple', 'nonce-3', false)
      expect(res.cookie).toHaveBeenCalledWith(
        'oauth_state_apple',
        'nonce-3',
        expect.objectContaining({ sameSite: 'none', secure: true })
      )
    })

    it('ties Secure to the production flag for the Lax redirect cookie', () => {
      const res = mockRes()
      setOAuthBindingCookie(res, 'google', 'nonce-4', false)
      expect(res.cookie).toHaveBeenCalledWith(
        'oauth_state',
        'nonce-4',
        expect.objectContaining({ sameSite: 'lax', secure: false })
      )
    })
  })

  describe('readOAuthBindingNonce', () => {
    it('reads the Apple cookie for the apple provider', () => {
      const req = mockReq({ oauth_state_apple: 'a', oauth_state: 'b' })
      expect(readOAuthBindingNonce(req, 'apple')).toBe('a')
    })

    it('reads the default cookie for redirect providers', () => {
      const req = mockReq({ oauth_state_apple: 'a', oauth_state: 'b' })
      expect(readOAuthBindingNonce(req, 'google')).toBe('b')
    })

    it('returns undefined when the matching cookie is absent', () => {
      expect(readOAuthBindingNonce(mockReq({}), 'apple')).toBeUndefined()
    })
  })

  describe('clearOAuthBindingCookie', () => {
    it('clears the Apple cookie with its scoped path', () => {
      const res = mockRes()
      clearOAuthBindingCookie(res, 'apple')
      expect(res.clearCookie).toHaveBeenCalledWith('oauth_state_apple', { path: APPLE_PATH })
    })

    it('clears the default cookie at root path', () => {
      const res = mockRes()
      clearOAuthBindingCookie(res, 'google')
      expect(res.clearCookie).toHaveBeenCalledWith('oauth_state', { path: '/' })
    })
  })
})
