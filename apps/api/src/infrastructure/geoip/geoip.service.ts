import { stat } from 'node:fs/promises'

import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { type CityResponse, open, type Reader } from 'maxmind'
import { PinoLogger } from 'nestjs-pino'

import { type SessionLocation, type SupportedLocale } from '@amcore/shared'

import { EnvService } from '../../env/env.service'

import { normalizeIpForGeoLookup } from './ip-normalize'

/**
 * Approximate IP-to-location reader. Holds one long-lived `Reader`
 * per process — never opens the database per request. `resolve()` degrades
 * to `null` whenever geolocation is unavailable for any reason (disabled,
 * database never loaded, private/reserved/malformed address, or no match)
 * — auth, session listing and revoke all stay fully usable without it.
 *
 * Every process polls file generations; the worker swaps validated files atomically. A
 * failed reload keeps serving the previously loaded reader (or `null` if
 * none was ever loaded) — it never throws into a request path.
 */
@Injectable()
export class GeoIpService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>
  private generation: string | null = null
  private failedGeneration: string | null = null
  private retryAt = 0
  private checking = false
  private reader: Reader<CityResponse> | null = null

  constructor(
    private readonly env: EnvService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(GeoIpService.name)
  }

  async onModuleInit(): Promise<void> {
    if (!this.env.get('GEOIP_ENABLED')) return
    await this.checkGeneration()
    this.timer = setInterval(() => void this.checkGeneration(), 30_000)
    this.timer.unref()
  }

  onModuleDestroy(): void {
    clearInterval(this.timer)
  }

  /** Every process detects atomic file replacement, including absence at first boot. */
  async checkGeneration(): Promise<void> {
    if (this.checking || !this.env.get('GEOIP_ENABLED')) return
    this.checking = true
    try {
      const file = await stat(this.env.get('GEOIP_DB_PATH'))
      const signature = `${file.ino}:${file.size}:${file.mtimeMs}`
      if (signature === this.generation) return
      if (signature === this.failedGeneration && Date.now() < this.retryAt) return
      try {
        await this.reload(false)
        this.generation = signature
        this.failedGeneration = null
      } catch (err) {
        // Retry transient read failures without repeating a warning for the same file.
        if (signature !== this.failedGeneration) this.logLoadFailure(err)
        this.failedGeneration = signature
        this.retryAt = Date.now() + 30_000
      }
    } catch {
      // Missing/invalid replacements retain the last valid reader. reload logs failures.
    } finally {
      this.checking = false
    }
  }

  /** Loads (or replaces) the reader from the current `GEOIP_DB_PATH`. */
  async reload(logFailure = true): Promise<void> {
    const path = this.env.get('GEOIP_DB_PATH')
    try {
      const next = await open<CityResponse>(path)
      this.reader = next
      this.logger.info(
        { event: 'geoip.reader_loaded', buildEpoch: next.metadata.buildEpoch },
        'GeoIP database loaded'
      )
    } catch (err) {
      if (logFailure) this.logLoadFailure(err)
      throw err
    }
  }

  private logLoadFailure(err: unknown): void {
    this.logger.warn(
      { event: 'geoip.reader_load_failed', err },
      'GeoIP reload failed — retaining the last reader and retrying on the next generation check'
    )
  }

  /** The build epoch of the currently loaded database, or `null` if none is loaded. */
  currentBuildEpoch(): Date | null {
    return this.reader?.metadata.buildEpoch ?? null
  }

  /**
   * Resolve an approximate location for `ipAddress` in `locale`, or `null`
   * when unavailable. `city` falls back to English when the negotiated
   * locale's name is absent from the database; `countryCode` is a narrow
   * ISO code the caller localizes itself.
   */
  resolve(ipAddress: string | null, locale: SupportedLocale): SessionLocation | null {
    if (!this.reader) return null
    const normalized = normalizeIpForGeoLookup(ipAddress)
    if (!normalized) return null

    let result: CityResponse | null
    try {
      result = this.reader.get(normalized)
    } catch {
      return null
    }
    if (!result) return null

    const names = result.city?.names as Record<string, string | undefined> | undefined
    const city = names?.[locale] ?? names?.en ?? null
    const countryCode = result.country?.iso_code ?? null
    if (city === null && countryCode === null) return null

    return { city, countryCode }
  }
}
