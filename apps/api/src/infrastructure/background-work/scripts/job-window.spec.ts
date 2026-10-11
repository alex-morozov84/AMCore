import type { Queue } from 'bullmq'
import type { Redis } from 'ioredis'

import { readJobWindow } from './job-window'

describe('bounded broker ID search', () => {
  const queue = { toKey: (suffix: string) => `work:${suffix}` } as Queue

  it('matches literal IDs before pagination and retains the original window witness', async () => {
    const evalCommand = jest.fn().mockResolvedValue(['observed', ['job_1', 'job_2', 'job_3'], '1'])
    const client = { eval: evalCommand } as unknown as Redis
    const query = { state: 'failed' as const, page: 1, limit: 1, search: 'JOB_3' }
    expect(await readJobWindow(client, queue, query, false)).toEqual({
      ids: ['job_3'],
      truncated: true,
    })
    expect(await readJobWindow(client, queue, { ...query, search: '%' }, false)).toEqual({
      ids: [],
      truncated: true,
    })
    expect(evalCommand).toHaveBeenLastCalledWith(expect.any(String), 1, 'work:failed', 'zset')
  })
})
