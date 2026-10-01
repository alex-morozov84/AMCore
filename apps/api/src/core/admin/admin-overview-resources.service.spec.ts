import { sampleOverviewFilesystem } from './admin-overview-filesystem'
import { AdminOverviewResourcesService } from './admin-overview-resources.service'

jest.mock('./admin-overview-filesystem', () => ({ sampleOverviewFilesystem: jest.fn() }))

const disk = jest.mocked(sampleOverviewFilesystem)

describe('Overview independent resource snapshots', () => {
  const pool = { getPoolStats: jest.fn() }
  let service: AdminOverviewResourcesService

  beforeEach(() => {
    pool.getPoolStats.mockReturnValue({ total: 3, idle: 1, waiting: 7 })
    disk.mockResolvedValue({ path: '/', totalBytes: 1000, availableBytes: 100, pressureRatio: 0.9 })
    const values = {
      DATABASE_POOL_MAX: 10,
      DATABASE_POOL_WAITING_THRESHOLD: 5,
      HEALTH_MEMORY_HEAP_BYTES: 100,
      HEALTH_DISK_THRESHOLD_PERCENT: 0.9,
    }
    service = new AdminOverviewResourcesService(
      pool as any,
      {
        get: (key: keyof typeof values) => values[key],
      } as any
    )
    jest.spyOn(process, 'memoryUsage').mockReturnValue({
      heapUsed: 150,
      rss: 500,
      heapTotal: 200,
      external: 0,
      arrayBuffers: 0,
    })
  })

  afterEach(() => jest.restoreAllMocks())

  it('reports measurements beyond triggers without generating another health verdict', async () => {
    const result = await service.sample()
    expect(result.resources.pool).toMatchObject({
      status: 'available',
      waiting: 7,
      waitingThreshold: 5,
    })
    expect(result.resources.memory).toMatchObject({
      status: 'available',
      heapUsedBytes: 150,
      readinessHeapLimitBytes: 100,
    })
    expect(result.resources.filesystem).toMatchObject({
      status: 'available',
      pressureRatio: 0.9,
      pressureThreshold: 0.9,
    })
    expect(result.process.uptimeSeconds).toBeGreaterThanOrEqual(0)
    expect(result.process.instanceId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('isolates a failed filesystem sample and never fabricates its timestamp', async () => {
    disk.mockRejectedValue(new Error('private mount detail'))
    const result = await service.sample()
    expect(result.resources.filesystem).toEqual({ status: 'unavailable', sampledAt: null })
    expect(result.resources.pool.status).toBe('available')
    expect(result.resources.memory.status).toBe('available')
    expect(JSON.stringify(result)).not.toContain('private mount detail')
  })

  it('does not substitute zero for invalid pool data', async () => {
    pool.getPoolStats.mockReturnValue({ total: NaN, idle: 0, waiting: 0 })
    expect((await service.sample()).resources.pool).toEqual({
      status: 'unavailable',
      sampledAt: null,
    })
  })

  it('keeps the process identity stable across observations', async () => {
    const first = await service.sample()
    const next = await service.sample()
    expect(next.process.instanceId).toBe(first.process.instanceId)
    expect(disk).toHaveBeenCalled()
  })
})
