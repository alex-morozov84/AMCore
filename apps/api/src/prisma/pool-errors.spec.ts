import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

import { observePoolErrors } from './pool-errors'

describe('owned pool error listener', () => {
  it('survives actual adapter disposal and reports a late shutdown error without client data', async () => {
    const pool = new Pool()
    const logger = { error: jest.fn() }
    let stopping = false
    observePoolErrors(pool, logger, () => stopping)
    const adapter = await new PrismaPg(pool).connect()
    expect(pool.listenerCount('error')).toBe(2)
    stopping = true
    await adapter.dispose()
    expect(pool.listenerCount('error')).toBe(1)
    const error = Object.assign(new Error('SECRET connection details'), { code: '57P01' })
    expect(() => pool.emit('error', error, { password: 'SECRET client' })).not.toThrow()
    expect(logger.error).toHaveBeenCalledWith(
      { event: 'prisma.pool_error', phase: 'shutdown', sqlState: '57P01' },
      'PostgreSQL idle connection failed'
    )
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('SECRET')
    await pool.end()
  })

  it('reports runtime failures and excludes arbitrary code/message fields', async () => {
    const pool = new Pool()
    const logger = { error: jest.fn() }
    observePoolErrors(pool, logger, () => false)
    pool.emit('error', Object.assign(new Error('SECRET message'), { code: 'SECRET value' }))
    expect(logger.error).toHaveBeenCalledWith(
      { event: 'prisma.pool_error', phase: 'runtime', sqlState: 'unknown' },
      'PostgreSQL idle connection failed'
    )
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('SECRET')
    await pool.end()
  })
})
