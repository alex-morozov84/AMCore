import { copyFile, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { PinoLogger } from 'nestjs-pino'

import type { EnvService } from '../../env/env.service'

import { GeoIpService } from './geoip.service'

const fixture = join(__dirname, '../../../test/fixtures/geoip/GeoIP2-City-Test.mmdb')

it('independent readers recover from missing boot, detect atomic generations and retain the last valid reader', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'amcore-geoip-reader-'))
  const path = join(dir, 'live.mmdb')
  const env = {
    get: (key: string) => (key === 'GEOIP_ENABLED' ? true : path),
  } as unknown as EnvService
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  } as unknown as PinoLogger
  const api = new GeoIpService(env, logger),
    worker = new GeoIpService(env, logger)
  try {
    await Promise.all([api.onModuleInit(), worker.onModuleInit()])
    expect(api.resolve('81.2.69.142', 'en')).toBeNull()
    await copyFile(fixture, join(dir, 'next'))
    await rename(join(dir, 'next'), path)
    await worker.checkGeneration()
    expect(api.resolve('81.2.69.142', 'en')).toBeNull()
    await api.checkGeneration()
    expect(api.resolve('81.2.69.142', 'en')).toEqual({ city: 'London', countryCode: 'GB' })
    expect(api.resolve('::ffff:81.2.69.142', 'ru')).toEqual({ city: 'Лондон', countryCode: 'GB' })
    expect(api.resolve('::ffff:5102:458e', 'en')).toEqual({ city: 'London', countryCode: 'GB' })
    for (const ip of [
      '::ffff:127.0.0.1',
      '0:0:0:0:0:ffff:7f00:1',
      'fe90::1',
      'ff02::1',
      '2001:db8::1',
      'invalid:ip',
    ]) {
      expect(api.resolve(ip, 'en')).toBeNull()
    }
    const loads = jest.mocked(logger.info).mock.calls.length
    for (let i = 0; i < 50; i++) api.resolve('81.2.69.142', 'en')
    await api.checkGeneration()
    expect(jest.mocked(logger.info).mock.calls).toHaveLength(loads)
    await writeFile(join(dir, 'bad'), 'invalid MMDB')
    await rename(join(dir, 'bad'), path)
    await api.checkGeneration()
    expect(api.resolve('81.2.69.142', 'en')).toEqual({ city: 'London', countryCode: 'GB' })
    const warnings = jest.mocked(logger.warn).mock.calls.length
    await api.checkGeneration()
    expect(jest.mocked(logger.warn).mock.calls).toHaveLength(warnings)
    await copyFile(fixture, join(dir, 'recovery'))
    await rename(join(dir, 'recovery'), path)
    await api.checkGeneration()
    expect(jest.mocked(logger.info).mock.calls.length).toBe(loads + 1)
  } finally {
    api.onModuleDestroy()
    worker.onModuleDestroy()
    await rm(dir, { recursive: true, force: true })
  }
})
