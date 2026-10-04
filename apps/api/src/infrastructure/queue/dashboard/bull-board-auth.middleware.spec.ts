import type { Request, Response } from 'express'

import { BULL_BOARD_CONTEXT_HEADER } from '@amcore/shared'

import { createBullBoardAuthMiddleware } from './bull-board-auth.middleware'
import type { BullBoardAccess, BullBoardAuthService } from './bull-board-auth.service'
import type { BullBoardBearerAccess } from './bull-board-bearer-auth.service'
import type { BoardEvent } from './bull-board-events'

const CONTEXT = {
  basePath: '/api/console/bull-board',
  locale: 'ru',
  returnHref: '/ru/admin/background-work',
}
const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')

describe('createBullBoardAuthMiddleware (Bull Board admission — EQS-01)', () => {
  let verifyAccess: jest.Mock<Promise<BullBoardAccess>, [string]>
  let verify: jest.Mock<Promise<BullBoardBearerAccess>, [string]>
  let next: jest.Mock
  let status: jest.Mock
  let end: jest.Mock
  let res: Response
  let events: BoardEvent[]

  const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

  const makeReq = (headers: Record<string, string | undefined>): Request =>
    ({ headers: { ...headers } }) as unknown as Request

  beforeEach(() => {
    verifyAccess = jest.fn()
    verify = jest.fn()
    next = jest.fn()
    end = jest.fn()
    status = jest.fn().mockReturnValue({ end })
    res = { status, end, locals: {} } as unknown as Response
    events = []
  })

  const run = async (headers: Record<string, string | undefined>): Promise<Request> => {
    const req = makeReq(headers)
    createBullBoardAuthMiddleware(
      { verifyAccess } as unknown as BullBoardAuthService,
      { verify },
      (event) => events.push(event)
    )(req, res, next)
    await flush()
    return req
  }

  describe('machine credentials', () => {
    it('rejects an API key on the Authorization header before any verification (401)', async () => {
      await run({
        authorization: 'Bearer amcore_live_shorttoken00_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      })
      expect(status).toHaveBeenCalledWith(401)
      expect(next).not.toHaveBeenCalled()
      expect(verifyAccess).not.toHaveBeenCalled()
      expect(verify).not.toHaveBeenCalled()
      expect(events).toEqual([{ event: 'bull_board.access_denied', reason: 'api_key' }])
    })

    it('rejects an x-api-key header outright (belt-and-suspenders for aliases)', async () => {
      await run({ 'x-api-key': 'anything', cookie: 'refresh_token=abc' })
      expect(status).toHaveBeenCalledWith(401)
      expect(verifyAccess).not.toHaveBeenCalled()
    })
  })

  describe('cookie (direct access)', () => {
    it('returns 401 when no refresh_token cookie is present', async () => {
      await run({ cookie: 'other=1; another=2' })
      expect(status).toHaveBeenCalledWith(401)
      expect(verifyAccess).not.toHaveBeenCalled()
    })

    it('admits an authorized SUPER_ADMIN cookie and marks the credential', async () => {
      verifyAccess.mockResolvedValue('authorized')
      await run({ cookie: 'refresh_token=abc123; theme=dark' })
      expect(verifyAccess).toHaveBeenCalledWith('abc123')
      expect(next).toHaveBeenCalledTimes(1)
      expect(status).not.toHaveBeenCalled()
      expect(res.locals.boardCredential).toBe('cookie')
      expect(res.locals.boardContext).toBeUndefined()
    })

    it('never accepts the render context on a cookie request', async () => {
      verifyAccess.mockResolvedValue('authorized')
      const req = await run({
        cookie: 'refresh_token=abc123',
        [BULL_BOARD_CONTEXT_HEADER]: encode(CONTEXT),
      })
      expect(next).toHaveBeenCalledTimes(1)
      expect(res.locals.boardContext).toBeUndefined()
      expect(req.headers[BULL_BOARD_CONTEXT_HEADER]).toBeUndefined()
    })

    it.each([
      ['forbidden', 403],
      ['unauthenticated', 401],
    ] as const)('returns %s as %i', async (access, code) => {
      verifyAccess.mockResolvedValue(access)
      await run({ cookie: 'refresh_token=abc123' })
      expect(status).toHaveBeenCalledWith(code)
      expect(next).not.toHaveBeenCalled()
    })

    it('fails closed (401) if the verifier throws', async () => {
      verifyAccess.mockRejectedValue(new Error('redis down'))
      await run({ cookie: 'refresh_token=abc123' })
      expect(status).toHaveBeenCalledWith(401)
      expect(next).not.toHaveBeenCalled()
      expect(events).toEqual([{ event: 'bull_board.access_denied', reason: 'unavailable' }])
    })
  })

  describe('bearer (Console BFF)', () => {
    it('admits a live SUPER_ADMIN token, records the actor and parses the render context', async () => {
      verify.mockResolvedValue({ kind: 'authorized', userId: 'admin-1' })
      await run({ authorization: 'Bearer token-1', [BULL_BOARD_CONTEXT_HEADER]: encode(CONTEXT) })
      expect(verify).toHaveBeenCalledWith('token-1')
      expect(next).toHaveBeenCalledTimes(1)
      expect(res.locals).toMatchObject({
        boardCredential: 'bearer',
        boardActorId: 'admin-1',
        boardContext: CONTEXT,
      })
      expect(verifyAccess).not.toHaveBeenCalled()
    })

    it('admits a token without a render context and renders with defaults', async () => {
      verify.mockResolvedValue({ kind: 'authorized', userId: 'admin-1' })
      await run({ authorization: 'bearer token-1' })
      expect(next).toHaveBeenCalledTimes(1)
      expect(res.locals.boardContext).toBeUndefined()
    })

    it.each([
      [{ kind: 'unauthenticated' }, 401, 'unauthenticated'],
      [{ kind: 'forbidden' }, 403, 'forbidden'],
      [{ kind: 'unavailable' }, 503, 'unavailable'],
    ] as const)('maps %j to %i', async (access, code, reason) => {
      verify.mockResolvedValue(access)
      await run({ authorization: 'Bearer token-1' })
      expect(status).toHaveBeenCalledWith(code)
      expect(next).not.toHaveBeenCalled()
      expect(events).toEqual([{ event: 'bull_board.access_denied', reason }])
    })

    it('treats a verifier crash as unavailable (503), never as a pass', async () => {
      verify.mockRejectedValue(new Error('db down'))
      await run({ authorization: 'Bearer token-1' })
      expect(status).toHaveBeenCalledWith(503)
      expect(next).not.toHaveBeenCalled()
    })

    it('judges an Authorization header only as a bearer, even with a valid cookie', async () => {
      verifyAccess.mockResolvedValue('authorized')
      verify.mockResolvedValue({ kind: 'unauthenticated' })
      await run({ authorization: 'Bearer expired', cookie: 'refresh_token=valid' })
      expect(status).toHaveBeenCalledWith(401)
      expect(next).not.toHaveBeenCalled()
      expect(verifyAccess).not.toHaveBeenCalled()
    })

    it.each(['Basic abc', 'Bearer', 'Bearer a b', 'token-only', ''])(
      'refuses a malformed Authorization header %j without any verification',
      async (authorization) => {
        verifyAccess.mockResolvedValue('authorized')
        await run({ authorization, cookie: 'refresh_token=valid' })
        expect(status).toHaveBeenCalledWith(401)
        expect(verify).not.toHaveBeenCalled()
        expect(verifyAccess).not.toHaveBeenCalled()
      }
    )

    it.each([
      ['not base64url', 'not base64!'],
      ['not json', Buffer.from('nope').toString('base64url')],
      ['oversized', 'a'.repeat(2000)],
      ['extra key', encode({ ...CONTEXT, role: 'SUPER_ADMIN' })],
      ['absolute base path', encode({ ...CONTEXT, basePath: 'https://evil.example/x' })],
      ['protocol-relative return', encode({ ...CONTEXT, returnHref: '//evil.example' })],
      ['unknown locale', encode({ ...CONTEXT, locale: 'de' })],
    ])('answers 400 for an invalid render context (%s) after admission', async (_label, header) => {
      verify.mockResolvedValue({ kind: 'authorized', userId: 'admin-1' })
      await run({ authorization: 'Bearer token-1', [BULL_BOARD_CONTEXT_HEADER]: header })
      expect(status).toHaveBeenCalledWith(400)
      expect(next).not.toHaveBeenCalled()
      expect(events).toEqual([{ event: 'bull_board.access_denied', reason: 'invalid_context' }])
    })

    it('does not read the render context of a request that is not admitted', async () => {
      verify.mockResolvedValue({ kind: 'forbidden' })
      await run({ authorization: 'Bearer token-1', [BULL_BOARD_CONTEXT_HEADER]: 'garbage!' })
      expect(status).toHaveBeenCalledWith(403)
    })
  })
})
