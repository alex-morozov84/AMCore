import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isPrimaryUnavailableError } from '@/shared/api/server/require-primary'
import { logServerError } from '@/shared/lib/server-logger'

import { onRequestError } from './instrumentation'

vi.mock('@/shared/lib/server-logger', () => ({ logServerError: vi.fn() }))
vi.mock('@/shared/api/server/require-primary', () => ({ isPrimaryUnavailableError: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isPrimaryUnavailableError).mockReturnValue(false)
})

const context = {
  routerKind: 'App Router',
  routePath: '/[locale]/dashboard',
  routeType: 'render',
  renderSource: 'react-server-components',
  revalidateReason: undefined,
  renderType: 'dynamic',
} as const

describe('onRequestError', () => {
  it('logs the error message and digest for a real Error instance', async () => {
    const error = Object.assign(new Error('boom'), { digest: 'abc123' })

    await onRequestError(error, { path: '/x', method: 'GET', headers: {} }, context as never)

    expect(logServerError).toHaveBeenCalledWith({
      routePath: '/[locale]/dashboard',
      routeType: 'render',
      digest: 'abc123',
      message: 'boom',
    })
  })

  it('stringifies a non-Error thrown value and omits digest when absent', async () => {
    await onRequestError(
      'a raw string was thrown',
      { path: '/x', method: 'GET', headers: {} },
      context as never
    )

    expect(logServerError).toHaveBeenCalledWith({
      routePath: '/[locale]/dashboard',
      routeType: 'render',
      digest: undefined,
      message: 'a raw string was thrown',
    })
  })

  it('skips logging a PrimaryUnavailableError - it already logged itself at throw time', async () => {
    vi.mocked(isPrimaryUnavailableError).mockReturnValue(true)
    const error = Object.assign(new Error('primary content unavailable (upstream)'), {
      digest: 'abc123',
    })

    await onRequestError(error, { path: '/x', method: 'GET', headers: {} }, context as never)

    expect(logServerError).not.toHaveBeenCalled()
  })
})
