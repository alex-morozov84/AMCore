import { Injectable, Module, type OnModuleInit } from '@nestjs/common'

import { ScheduledJobsModule } from '../schedule/scheduled-jobs.module.js'
import { SingletonCronRunner } from '../schedule/singleton-cron.runner.js'

import { GeoipModule } from './geoip.module.js'
import { GeoIpUpdateService } from './geoip-update.service.js'

@Injectable()
class GeoIpBootstrapService implements OnModuleInit {
  constructor(private readonly updater: GeoIpUpdateService) {}
  async onModuleInit(): Promise<void> {
    await this.updater.bootstrapIfMissing()
  }
}

/** Imported only by the worker/all scheduler; web processes never download. */
@Module({
  imports: [GeoipModule, ScheduledJobsModule],
  providers: [SingletonCronRunner, GeoIpUpdateService, GeoIpBootstrapService],
})
export class GeoipUpdaterModule {}
