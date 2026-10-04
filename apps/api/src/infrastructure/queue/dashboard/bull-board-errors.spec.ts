import {
  clientErrorStatus,
  finalizeResult,
  safeErrorResult,
  withFinalBoundary,
} from './bull-board-errors'

const CANARY = 'CANARY_VALIDATOR_SECRET'

describe('final boundary for board responses', () => {
  it('passes a success through untouched', () => {
    const ok = { status: 200 as const, body: { queues: [] } }
    expect(finalizeResult(ok)).toBe(ok)
    expect(finalizeResult({ status: 204, body: {} })).toEqual({ status: 204, body: {} })
  })

  it('reduces the board response-schema mismatch to a key, dropping the validator text', () => {
    const mismatch = {
      status: 500 as const,
      body: {
        error: { key: 'ERRORS.INTERNAL_SERVER_ERROR' },
        code: 'RESPONSE_SCHEMA_MISMATCH',
        details: `GetQueuesResponse: Invalid type: Expected number but received "${CANARY}"`,
      },
    }
    const result = finalizeResult(mismatch)
    expect(result).toEqual({
      status: 500,
      body: { error: { key: 'ERRORS.INTERNAL_SERVER_ERROR' } },
    })
    expect(JSON.stringify(result)).not.toContain(CANARY)
  })

  it('drops message, options and extra fields from any error and keeps the status', () => {
    const result = finalizeResult({
      status: 404,
      body: {
        error: { key: 'ERRORS.JOB_NOT_FOUND', options: { jobId: CANARY } },
        message: CANARY,
        details: CANARY,
      },
    })
    expect(result).toEqual({ status: 404, body: { error: { key: 'ERRORS.JOB_NOT_FOUND' } } })
  })

  it('does not trust an unknown key', () => {
    expect(finalizeResult({ status: 400, body: { error: { key: CANARY } } })).toEqual({
      status: 400,
      body: { error: { key: 'ERRORS.INVALID_QUERY_PARAM' } },
    })
    expect(safeErrorResult(403).body).toEqual({ error: { key: 'ERRORS.FORBIDDEN' } })
    expect(safeErrorResult(409).body).toEqual({ error: { key: 'ERRORS.INTERNAL_SERVER_ERROR' } })
  })

  it('turns a thrown error into a fixed 500, synchronously or asynchronously', async () => {
    const throwing = withFinalBoundary(() => {
      throw new Error(CANARY)
    })
    const rejecting = withFinalBoundary(() => Promise.reject(new Error(CANARY)))
    for (const result of [await throwing(undefined), await rejecting(undefined)]) {
      expect(result).toEqual({
        status: 500,
        body: { error: { key: 'ERRORS.INTERNAL_SERVER_ERROR' } },
      })
      expect(JSON.stringify(result)).not.toContain(CANARY)
    }
  })

  it('wraps a handler that returns a plain value or a promise', async () => {
    const value = { status: 200 as const, body: { ok: true } }
    expect(await withFinalBoundary(() => value)(undefined)).toBe(value)
    expect(await withFinalBoundary(() => Promise.resolve(value))(undefined)).toBe(value)
  })

  it.each([
    [{ status: 400 }, 400],
    [{ statusCode: 413 }, 400],
    [{ status: 415 }, 400],
    [{ status: 404 }, 404],
    [{ status: 405 }, 405],
    [{ status: 500 }, 500],
    [{ status: 302 }, 500],
    [new Error('CANARY'), 500],
    [null, 500],
  ])('keeps only the class of a framework failure: %j -> %s', (error, expected) => {
    expect(clientErrorStatus(error)).toBe(expected)
  })
})
