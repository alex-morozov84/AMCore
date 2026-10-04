import {
  BOARD_MAX_JOBS_PER_PAGE,
  decideBoardRoute,
  isValidQueuesQuery,
} from './bull-board-route-policy'

const none = new URLSearchParams()
const pass = (entry: boolean) => ({ kind: 'pass', entry })
const reject = (status: number) => ({ kind: 'reject', status })

describe('board route policy', () => {
  it.each([
    ['/', true],
    ['/queue/email', true],
    ['/queue/email/42', true],
    ['/queue/email/42/', true],
    ['/static/js/main.abc.js', false],
    ['/static/css/main.css', false],
    ['/api/queues', false],
    ['/api/queues/email/42', false],
    ['/api/queues/email/job:1_a-b.c', false],
  ])('lets %s through', (path, entry) => {
    expect(decideBoardRoute(path, none)).toEqual(pass(entry))
  })

  it('answers job logs with a fixed message instead of reading them', () => {
    expect(decideBoardRoute('/api/queues/email/42/logs', none)).toEqual({
      kind: 'synthetic',
      channel: 'logs',
    })
  })

  it.each([
    '/api/queues/email/42/flow',
    '/api/queues/email/workers',
    '/api/queues/email/metrics',
    '/api/queues/email/default-job-options',
    '/api/queues/email/rate-limit',
    '/api/queues/email/job-data-schema',
    '/api/queues/email/job-schedulers',
    '/api/queues/email/42/extra/deeper',
    '/api/queues/pause',
    '/api/queues/resume',
    '/api/job-schedulers',
    '/api/redis/stats',
    '/api/metrics/history',
    '/api/metrics/latency',
    '/metrics-history',
    '/job-schedulers',
    '/queue',
    '/queue/email/42/extra',
    '/queue/bad name',
    '/static/',
    '/unknown',
    '/api',
    '/api/queues/email',
  ])('closes %s', (path) => {
    expect(decideBoardRoute(path, none)).toEqual(reject(404))
  })

  it.each([
    '/api/queues/email%2F42',
    '/api/queues/%2e%2e/x',
    '/static/..%2f..%2fetc',
    '/static/../x',
    '/api/queues//email/1',
    '/api\\queues',
    '/static/a//b',
  ])('rejects hostile path %s', (path) => {
    expect(decideBoardRoute(path, none)).toEqual(reject(404))
  })

  it('bounds the queues query', () => {
    const query = (qs: string) => new URLSearchParams(qs)
    expect(isValidQueuesQuery(query('activeQueue=email&status=failed&page=2&jobsPerPage=10'))).toBe(
      true
    )
    expect(isValidQueuesQuery(query(`jobsPerPage=${BOARD_MAX_JOBS_PER_PAGE}`))).toBe(true)
    for (const bad of [
      `jobsPerPage=${BOARD_MAX_JOBS_PER_PAGE + 1}`,
      'jobsPerPage=0',
      'page=0',
      'page=10001',
      'page=1.5',
      'page=x',
      'status=bogus',
      'activeQueue=a%20b',
      'activeQueue=',
      'unknown=1',
      'page=1&page=2',
    ]) {
      expect(isValidQueuesQuery(query(bad))).toBe(false)
    }
    expect(decideBoardRoute('/api/queues', query('jobsPerPage=999'))).toEqual(reject(400))
  })
})
