import { beforeEach, describe, expect, it, vi } from 'vitest'

import { logServerError } from '@/shared/lib/server-logger'

import { onRequestError } from './instrumentation'

vi.mock('@/shared/lib/server-logger', () => ({ logServerError: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
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
  it('logs the bounded error name and digest for a real Error instance', async () => {
    const error = Object.assign(new Error('boom'), { digest: 'abc123' })

    await onRequestError(error, { path: '/x', method: 'GET', headers: {} }, context as never)

    expect(logServerError).toHaveBeenCalledWith({
      routePath: '/[locale]/dashboard',
      routeType: 'render',
      digest: 'abc123',
      errorName: 'Error',
    })
  })

  it('logs only the type of a non-Error thrown value and omits digest when absent', async () => {
    await onRequestError(
      'a raw string was thrown',
      { path: '/x', method: 'GET', headers: {} },
      context as never
    )

    expect(logServerError).toHaveBeenCalledWith({
      routePath: '/[locale]/dashboard',
      routeType: 'render',
      digest: undefined,
      errorName: 'string',
    })
  })
})
