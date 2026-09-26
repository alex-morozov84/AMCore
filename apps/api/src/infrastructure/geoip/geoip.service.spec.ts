import type { PinoLogger } from 'nestjs-pino'

import type { EnvService } from '../../env/env.service'

import { GeoIpService } from './geoip.service'

const openMock = jest.fn()
jest.mock('maxmind', () => ({ open: (...args: unknown[]) => openMock(...args) }))

describe('GeoIpService', () => {
  let env: { get: jest.Mock }
  let logger: jest.Mocked<PinoLogger>
  let service: GeoIpService

  afterEach(() => service.onModuleDestroy())

  beforeEach(() => {
    openMock.mockReset()
    env = {
      get: jest.fn((key: string) => {
        if (key === 'GEOIP_ENABLED') return true
        if (key === 'GEOIP_DB_PATH') return '/data/geoip/dbip-city-lite.mmdb'
        throw new Error(`unexpected env key ${key}`)
      }),
    }
    logger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<PinoLogger>
    service = new GeoIpService(env as unknown as EnvService, logger)
  })

  it('resolves to null and does not throw when no reader has ever loaded', () => {
    expect(service.resolve('203.0.0.1', 'en')).toBeNull()
    expect(service.currentBuildEpoch()).toBeNull()
  })

  it('onModuleInit degrades silently when the database is not yet available', async () => {
    openMock.mockRejectedValue(new Error('ENOENT'))

    await expect(service.onModuleInit()).resolves.toBeUndefined()
    expect(service.resolve('203.0.0.1', 'en')).toBeNull()
  })

  it('skips loading entirely when GEOIP_ENABLED is false', async () => {
    env.get.mockImplementation((key: string) => (key === 'GEOIP_ENABLED' ? false : '/x'))

    await service.onModuleInit()

    expect(openMock).not.toHaveBeenCalled()
  })

  describe('once a reader is loaded', () => {
    const buildEpoch = new Date('2026-09-01T00:00:00.000Z')

    function fakeReader(get: (ip: string) => unknown) {
      return { metadata: { buildEpoch }, get }
    }

    it('returns city (negotiated locale) and countryCode for a resolvable address', async () => {
      openMock.mockResolvedValue(
        fakeReader(() => ({
          city: { names: { en: 'Berlin', ru: 'Берлин' } },
          country: { iso_code: 'DE' },
        }))
      )
      await service.reload()

      expect(service.resolve('203.0.0.1', 'ru')).toEqual({ city: 'Берлин', countryCode: 'DE' })
      expect(service.currentBuildEpoch()).toEqual(buildEpoch)
    })

    it('falls back to the English city name when the negotiated locale is absent', async () => {
      openMock.mockResolvedValue(
        fakeReader(() => ({ city: { names: { en: 'Berlin' } }, country: { iso_code: 'DE' } }))
      )
      await service.reload()

      expect(service.resolve('203.0.0.1', 'ru')).toEqual({ city: 'Berlin', countryCode: 'DE' })
    })

    it('returns null for a private/reserved address without querying the reader', async () => {
      const get = jest.fn()
      openMock.mockResolvedValue(fakeReader(get))
      await service.reload()

      expect(service.resolve('10.0.0.5', 'en')).toBeNull()
      expect(get).not.toHaveBeenCalled()
    })

    it('returns null for a null ipAddress', async () => {
      openMock.mockResolvedValue(fakeReader(() => ({})))
      await service.reload()

      expect(service.resolve(null, 'en')).toBeNull()
    })

    it('returns null when the database has no match for the address', async () => {
      openMock.mockResolvedValue(fakeReader(() => null))
      await service.reload()

      expect(service.resolve('203.0.0.1', 'en')).toBeNull()
    })

    it('returns null when the reader throws (e.g. a corrupt/partial file)', async () => {
      openMock.mockResolvedValue(
        fakeReader(() => {
          throw new Error('corrupt database')
        })
      )
      await service.reload()

      expect(service.resolve('203.0.0.1', 'en')).toBeNull()
    })
  })
})
