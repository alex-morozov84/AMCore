import { Injectable, Module, type OnModuleInit } from '@nestjs/common'

import { SingletonCronRunner } from '../schedule/singleton-cron.runner'

import { GeoipModule } from './geoip.module'
import { GeoIpUpdateService } from './geoip-update.service'

@Injectable()
class GeoIpBootstrapService implements OnModuleInit {
  constructor(private readonly updater: GeoIpUpdateService) {}
  async onModuleInit(): Promise<void> {
    await this.updater.bootstrapIfMissing()
  }
}

/** Imported only by the worker/all scheduler; web processes never download. */
@Module({
  imports: [GeoipModule],
  providers: [SingletonCronRunner, GeoIpUpdateService, GeoIpBootstrapService],
})
export class GeoipUpdaterModule {}
