import { mkdir, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

import { Injectable, Optional } from '@nestjs/common'
import { open } from 'maxmind'
import { PinoLogger } from 'nestjs-pino'

import { EnvService } from '../../env/env.service.js'
import { ScheduledJobExecutor } from '../schedule/scheduled-job.executor.js'
import {
  failed,
  ScheduledJob,
  type ScheduledJobResult,
  succeeded,
} from '../schedule/scheduled-job.js'
import { GEOIP_UPDATE_JOB } from '../schedule/scheduled-jobs.catalogue.js'
import { SingletonCronRunner } from '../schedule/singleton-cron.runner.js'

import { GeoIpService } from './geoip.service.js'
import { buildDbIpDownloadUrl, currentEdition, downloadToFile } from './geoip-download.js'

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
    private readonly logger: PinoLogger,
    /** Absent in the one-shot CLI, which is deliberately not recorded as a scheduled run. */
    @Optional() private readonly jobs?: ScheduledJobExecutor
  ) {
    this.logger.setContext(GeoIpUpdateService.name)
  }

  async bootstrapIfMissing(): Promise<void> {
    if (!this.env.get('GEOIP_ENABLED')) return
    if (this.geoIp.currentBuildEpoch() !== null) return
    // One nonblocking bootstrap attempt — do not hold up application startup.
    void this.runGuarded()
  }

  @ScheduledJob(GEOIP_UPDATE_JOB)
  async scheduledUpdate(): Promise<void> {
    if (!this.env.get('GEOIP_ENABLED')) return
    // Only this scheduled path is recorded; bootstrap and the CLI run the same update under the
    // same lock (`runGuarded`) but never count as the scheduled run.
    if (!this.jobs) return this.runGuarded()
    await this.jobs.run(GEOIP_UPDATE_JOB, () => this.updateIfNeeded())
  }

  async runGuarded(): Promise<void> {
    if (!this.env.get('GEOIP_ENABLED')) return
    const { lock } = GEOIP_UPDATE_JOB
    await this.singletonCron.run(
      { name: lock!.logName, lockKey: lock!.key, ttlMs: lock!.ttlMs },
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
  private async updateIfNeeded(): Promise<ScheduledJobResult> {
    const loadedEpoch = this.geoIp.currentBuildEpoch()
    const wantedEdition = editionOf(new Date())

    let result: ScheduledJobResult
    if (loadedEpoch && editionOf(loadedEpoch) === wantedEdition) {
      this.logger.info({ event: 'geoip.update_skipped_current' }, 'GeoIP database already current')
      result = succeeded({ counts: {}, codes: ['already_current'] })
    } else {
      // A failed download is a failed run even though the previous database keeps serving.
      result = (await this.downloadAndSwap(wantedEdition))
        ? succeeded({ counts: {}, codes: ['updated'] })
        : failed('download_failed')
    }

    const currentLoadedEpoch = this.geoIp.currentBuildEpoch()
    if (currentLoadedEpoch && Date.now() - currentLoadedEpoch.getTime() > STALE_AFTER_MS) {
      this.logger.warn(
        { event: 'geoip.database_stale', buildEpoch: currentLoadedEpoch },
        'GeoIP database has not updated successfully in over 45 days; still serving approximate labels'
      )
    }
    return result
  }

  /** Resolves `true` when the new database is in place; a failure is logged and resolves `false`. */
  private async downloadAndSwap(edition: string): Promise<boolean> {
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
      return true
    } catch (err) {
      await unlink(tmpPath).catch(() => undefined)
      this.logger.warn(
        { event: 'geoip.update_failed', edition, err },
        'GeoIP database update failed — retaining the last good database, if any; will retry on the next scheduled check'
      )
      return false
    }
  }
}
