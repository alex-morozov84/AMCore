// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { isQueueBoardRoute } from './queue-board-route'

vi.mock('server-only', () => ({}))

const url = (path: string): URL => new URL(`http://api.invalid${path}`)

describe('isQueueBoardRoute', () => {
  it.each([
    '/api/v1/admin/queues',
    '/api/v1/admin/queues/',
    '/api/v1/admin/queues/api/queues',
    '/api/v1/admin/queues/static/js/main.js',
    '/api/v1/ADMIN/Queues/api/queues',
    '/api/v1/admin//queues/api/queues',
    '/api/v1/admin/queues/../queues/api/queues',
    '/api/v1/x/../admin/queues',
    '/api/v1/admin%2Fqueues',
    '/api/v1/admin%2fqueues/api/queues',
    '/api/v1/admin%5Cqueues',
    '/api/v1/%61dmin/queues',
    '/api/v1/admin/queues%2Fapi%2Fqueues',
    '/api/v1/admin/%2e%2e/admin/queues',
    '/api/v1/admin/%252e%252e/admin/queues',
    '/api/v1/admin%252Fqueues',
    '/api/v1\\admin\\queues',
  ])('closes %s', (path) => {
    expect(isQueueBoardRoute(url(path))).toBe(true)
  })

  it.each([
    '/api/v1/admin/background-work/queues',
    '/api/v1/admin/queuesX',
    '/api/v1/admin/queues-archive',
    '/api/v1/admin',
    '/api/v1/admin/users',
    '/api/v1/auth/me',
    '/api/v1/queues',
    '/api/v1/organizations/queues/admin/queues',
    '/api/v1/admin/queue',
  ])('leaves %s open', (path) => {
    expect(isQueueBoardRoute(url(path))).toBe(false)
  })
})
