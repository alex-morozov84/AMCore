import { mkdir, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { open } from 'maxmind'
import { PinoLogger } from 'nestjs-pino'

import { EnvService } from '../../env/env.service'
import { SingletonCronRunner } from '../schedule/singleton-cron.runner'

import { GeoIpService } from './geoip.service'
import { buildDbIpDownloadUrl, currentEdition, downloadToFile } from './geoip-download'

const LOCK_KEY = 'amcore:schedule:geoip:lock'
// Bounded task deadline, kept comfortably shorter than the lock TTL below so a
// slow-but-live updater never gets a second instance racing in past a crashed one.
const LOCK_TTL_MS = 30 * 60 * 1000
const STALE_AFTER_MS = 45 * 24 * 60 * 60 * 1000

function editionOf(date: Date): string {
  return currentEdition(date)
}

/** Worker/all updater; bootstrap, cron and manual execution share a singleton lock. */
@Injectable()
export class GeoIpUpdateService {
  constructor(
    private readonly env: EnvService,
    private readonly geoIp: GeoIpService,
    private readonly singletonCron: SingletonCronRunner,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(GeoIpUpdateService.name)
  }

  async bootstrapIfMissing(): Promise<void> {
    if (!this.env.get('GEOIP_ENABLED')) return
    if (this.geoIp.currentBuildEpoch() !== null) return
    // One nonblocking bootstrap attempt — do not hold up application startup.
    void this.runGuarded()
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { timeZone: 'UTC' })
  async scheduledUpdate(): Promise<void> {
    if (!this.env.get('GEOIP_ENABLED')) return
    await this.runGuarded()
  }

  async runGuarded(): Promise<void> {
    if (!this.env.get('GEOIP_ENABLED')) return
    await this.singletonCron.run(
      { name: 'schedule.geoip_update', lockKey: LOCK_KEY, ttlMs: LOCK_TTL_MS },
      () => this.updateIfNeeded()
    )
  }

  /**
   * Skips the ~120 MB download entirely when the loaded database already
   * matches this UTC month's edition. Logs a bounded operator-facing
   * warning — never a viewer-facing one — when the loaded generation is
   * older than the accepted staleness window; a stale-but-valid database
   * keeps serving approximate labels rather than being hidden.
   */
  private async updateIfNeeded(): Promise<void> {
    const loadedEpoch = this.geoIp.currentBuildEpoch()
    const wantedEdition = editionOf(new Date())

    if (loadedEpoch && editionOf(loadedEpoch) === wantedEdition) {
      this.logger.info({ event: 'geoip.update_skipped_current' }, 'GeoIP database already current')
    } else {
      await this.downloadAndSwap(wantedEdition)
    }

    const currentLoadedEpoch = this.geoIp.currentBuildEpoch()
    if (currentLoadedEpoch && Date.now() - currentLoadedEpoch.getTime() > STALE_AFTER_MS) {
      this.logger.warn(
        { event: 'geoip.database_stale', buildEpoch: currentLoadedEpoch },
        'GeoIP database has not updated successfully in over 45 days; still serving approximate labels'
      )
    }
  }

  private async downloadAndSwap(edition: string): Promise<void> {
    const dbPath = this.env.get('GEOIP_DB_PATH')
    const tmpPath = `${dbPath}.download-${process.pid}-${Date.now()}.tmp`
    const url = buildDbIpDownloadUrl(edition)

    try {
      await mkdir(dirname(dbPath), { recursive: true })
      await downloadToFile(url, tmpPath)
      // Validation: opening the file with the real reader already rejects
      // anything that is not a structurally valid MMDB.
      const candidate = await open(tmpPath)
      if (editionOf(candidate.metadata.buildEpoch) !== edition) {
        throw new Error('GeoIP database edition does not match the requested UTC month')
      }
      // Atomic same-directory replacement — a reader never observes a
      // partially-written file.
      await rename(tmpPath, dbPath)
      await this.geoIp.reload()
      this.logger.info({ event: 'geoip.update_succeeded', edition }, 'GeoIP database updated')
    } catch (err) {
      await unlink(tmpPath).catch(() => undefined)
      this.logger.warn(
        { event: 'geoip.update_failed', edition, err },
        'GeoIP database update failed — retaining the last good database, if any; will retry on the next scheduled check'
      )
    }
  }
}
