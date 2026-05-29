import type { Request, Response } from 'express'

import { createBullBoardAuthMiddleware } from './bull-board-auth.middleware'
import type { BullBoardAccess, BullBoardAuthService } from './bull-board-auth.service'

describe('createBullBoardAuthMiddleware (Bull Board auth — EQS-01)', () => {
  let verifyAccess: jest.Mock<Promise<BullBoardAccess>, [string]>
  let auth: BullBoardAuthService
  let next: jest.Mock
  let status: jest.Mock
  let end: jest.Mock
  let res: Response

  const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

  const makeReq = (headers: Record<string, string | undefined>): Request =>
    ({ headers }) as unknown as Request

  beforeEach(() => {
    verifyAccess = jest.fn()
    auth = { verifyAccess } as unknown as BullBoardAuthService
    next = jest.fn()
    end = jest.fn()
    status = jest.fn().mockReturnValue({ end })
    res = { status, end } as unknown as Response
  })

  const run = async (headers: Record<string, string | undefined>): Promise<void> => {
    createBullBoardAuthMiddleware(auth)(makeReq(headers), res, next)
    await flush()
  }

  it('rejects an API key on the Authorization header before any DB work (401)', async () => {
    await run({ authorization: 'Bearer amcore_live_shorttoken00_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })

    expect(status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
    expect(verifyAccess).not.toHaveBeenCalled()
  })

  it('rejects an x-api-key header outright (belt-and-suspenders for aliases)', async () => {
    await run({ 'x-api-key': 'anything' })

    expect(status).toHaveBeenCalledWith(401)
    expect(verifyAccess).not.toHaveBeenCalled()
  })

  it('returns 401 when no refresh_token cookie is present', async () => {
    await run({ cookie: 'other=1; another=2' })

    expect(status).toHaveBeenCalledWith(401)
    expect(verifyAccess).not.toHaveBeenCalled()
  })

  it('calls next() for an authorized SUPER_ADMIN cookie', async () => {
    verifyAccess.mockResolvedValue('authorized')

    await run({ cookie: 'refresh_token=abc123; theme=dark' })

    expect(verifyAccess).toHaveBeenCalledWith('abc123')
    expect(next).toHaveBeenCalledTimes(1)
    expect(status).not.toHaveBeenCalled()
  })

  it('returns 403 for a valid non-SUPER_ADMIN session', async () => {
    verifyAccess.mockResolvedValue('forbidden')

    await run({ cookie: 'refresh_token=abc123' })

    expect(status).toHaveBeenCalledWith(403)
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 for an unauthenticated (invalid/expired/revoked) session', async () => {
    verifyAccess.mockResolvedValue('unauthenticated')

    await run({ cookie: 'refresh_token=abc123' })

    expect(status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('fails closed (401) if the verifier throws', async () => {
    verifyAccess.mockRejectedValue(new Error('redis down'))

    await run({ cookie: 'refresh_token=abc123' })

    expect(status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })
})
