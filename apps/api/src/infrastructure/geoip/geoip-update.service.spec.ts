import type { PinoLogger } from 'nestjs-pino'

import type { EnvService } from '../../env/env.service'
import type { SingletonCronRunner } from '../schedule/singleton-cron.runner'

import type { GeoIpService } from './geoip.service'
import { GeoIpUpdateService } from './geoip-update.service'

const mkdirMock = jest.fn().mockResolvedValue(undefined)
const renameMock = jest.fn().mockResolvedValue(undefined)
const unlinkMock = jest.fn().mockResolvedValue(undefined)
jest.mock('node:fs/promises', () => ({
  mkdir: (...args: unknown[]) => mkdirMock(...args),
  rename: (...args: unknown[]) => renameMock(...args),
  unlink: (...args: unknown[]) => unlinkMock(...args),
}))

const downloadToFileMock = jest.fn().mockResolvedValue(undefined)
jest.mock('./geoip-download', () => {
  const actual = jest.requireActual('./geoip-download')
  return {
    ...actual,
    downloadToFile: (...args: unknown[]) => downloadToFileMock(...args),
  }
})

const openMock = jest.fn().mockResolvedValue({ metadata: { buildEpoch: new Date('2026-09-01') } })
jest.mock('maxmind', () => ({ open: (...args: unknown[]) => openMock(...args) }))

describe('GeoIpUpdateService', () => {
  let env: { get: jest.Mock }
  let geoIp: jest.Mocked<Pick<GeoIpService, 'currentBuildEpoch' | 'reload'>>
  let singletonCron: jest.Mocked<Pick<SingletonCronRunner, 'run'>>
  let logger: jest.Mocked<PinoLogger>
  let service: GeoIpUpdateService

  const now = new Date('2026-09-26T03:00:00.000Z')

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now)
    mkdirMock.mockClear()
    renameMock.mockClear()
    unlinkMock.mockClear()
    downloadToFileMock.mockClear().mockResolvedValue(undefined)
    openMock.mockClear().mockResolvedValue({ metadata: { buildEpoch: new Date('2026-09-01') } })

    env = {
      get: jest.fn((key: string) => {
        if (key === 'GEOIP_ENABLED') return true
        if (key === 'GEOIP_DB_PATH') return '/data/geoip/dbip-city-lite.mmdb'
        throw new Error(`unexpected env key ${key}`)
      }),
    }
    geoIp = {
      currentBuildEpoch: jest.fn().mockReturnValue(null),
      reload: jest.fn().mockResolvedValue(undefined),
    }
    singletonCron = {
      run: jest.fn().mockImplementation(async (_opts, task: () => Promise<void>) => {
        await task()
      }),
    }
    logger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<PinoLogger>

    service = new GeoIpUpdateService(
      env as unknown as EnvService,
      geoIp as unknown as GeoIpService,
      singletonCron as unknown as SingletonCronRunner,
      logger
    )
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('worker bootstrap', () => {
    it('attempts one nonblocking bootstrap download when no database is loaded yet', async () => {
      geoIp.currentBuildEpoch.mockReturnValue(null)

      await service.bootstrapIfMissing()
      await Promise.resolve() // flush the fire-and-forget bootstrap microtask

      expect(singletonCron.run).toHaveBeenCalledWith(
        expect.objectContaining({ lockKey: 'amcore:schedule:geoip:lock' }),
        expect.any(Function)
      )
      expect(downloadToFileMock).toHaveBeenCalled()
    })

    it('does not attempt a bootstrap download when a database is already loaded', async () => {
      geoIp.currentBuildEpoch.mockReturnValue(now)

      await service.bootstrapIfMissing()

      expect(singletonCron.run).not.toHaveBeenCalled()
    })

    it('does nothing when GeoIP is disabled', async () => {
      env.get.mockImplementation((key: string) => (key === 'GEOIP_ENABLED' ? false : '/x'))

      await service.bootstrapIfMissing()

      expect(singletonCron.run).not.toHaveBeenCalled()
    })
  })

  describe('scheduledUpdate', () => {
    it('skips downloading when the loaded database already matches this month’s edition', async () => {
      geoIp.currentBuildEpoch.mockReturnValue(new Date('2026-09-01T00:00:00.000Z'))

      await service.scheduledUpdate()

      expect(downloadToFileMock).not.toHaveBeenCalled()
    })

    it('downloads, validates and atomically swaps when the loaded edition is out of date', async () => {
      geoIp.currentBuildEpoch.mockReturnValue(new Date('2026-08-01T00:00:00.000Z'))

      await service.scheduledUpdate()

      expect(downloadToFileMock).toHaveBeenCalledWith(
        'https://download.db-ip.com/free/dbip-city-lite-2026-09.mmdb.gz',
        expect.stringContaining('.tmp')
      )
      expect(openMock).toHaveBeenCalled() // validation
      expect(renameMock).toHaveBeenCalledWith(
        expect.stringContaining('.tmp'),
        '/data/geoip/dbip-city-lite.mmdb'
      )
      expect(geoIp.reload).toHaveBeenCalled()
    })

    it('keeps the last good database and removes the temp file when validation fails', async () => {
      geoIp.currentBuildEpoch.mockReturnValue(null)
      openMock.mockRejectedValue(new Error('not a valid MMDB'))

      await service.scheduledUpdate()

      expect(renameMock).not.toHaveBeenCalled()
      expect(unlinkMock).toHaveBeenCalled()
      expect(geoIp.reload).not.toHaveBeenCalled()
    })

    it('rejects a structurally valid but wrong-month candidate before rename', async () => {
      openMock.mockResolvedValue({ metadata: { buildEpoch: new Date('2026-08-01') } })
      await service.runGuarded()
      expect(renameMock).not.toHaveBeenCalled()
      expect(unlinkMock).toHaveBeenCalled()
      expect(geoIp.reload).not.toHaveBeenCalled()
    })

    it('keeps the last good database and removes the temp file when the download itself fails', async () => {
      geoIp.currentBuildEpoch.mockReturnValue(null)
      downloadToFileMock.mockRejectedValue(new Error('network error'))

      await service.scheduledUpdate()

      expect(renameMock).not.toHaveBeenCalled()
      expect(unlinkMock).toHaveBeenCalled()
      expect(geoIp.reload).not.toHaveBeenCalled()
    })

    it('logs a bounded warning, but keeps serving, when the loaded database is stale', async () => {
      const staleEpoch = new Date(now.getTime() - 50 * 24 * 60 * 60 * 1000) // > 45 days
      geoIp.currentBuildEpoch.mockReturnValueOnce(staleEpoch).mockReturnValueOnce(staleEpoch)
      downloadToFileMock.mockRejectedValue(new Error('network error')) // update attempt fails; stays on stale

      await service.scheduledUpdate()

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'geoip.database_stale' }),
        expect.any(String)
      )
    })

    it('does nothing when GeoIP is disabled', async () => {
      env.get.mockImplementation((key: string) => (key === 'GEOIP_ENABLED' ? false : '/x'))

      await service.scheduledUpdate()

      expect(singletonCron.run).not.toHaveBeenCalled()
    })
  })
})
