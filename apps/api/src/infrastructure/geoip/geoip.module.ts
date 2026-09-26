import { Module } from '@nestjs/common'

import { GeoIpService } from './geoip.service'

/** Read-only lookup available in every process; updates belong to worker/all. */
@Module({ providers: [GeoIpService], exports: [GeoIpService] })
export class GeoipModule {}
