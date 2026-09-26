import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'

import { coreImports } from '../app-imports'
import { EnvService } from '../env/env.service'
import { GeoipModule } from '../infrastructure/geoip/geoip.module'
import { GeoIpService } from '../infrastructure/geoip/geoip.service'
import { currentEdition } from '../infrastructure/geoip/geoip-download'
import { GeoIpUpdateService } from '../infrastructure/geoip/geoip-update.service'
import { SingletonCronRunner } from '../infrastructure/schedule/singleton-cron.runner'

/** No scheduler/bootstrap/queue consumers; one guarded operator update. */
@Module({
  imports: [...coreImports(), GeoipModule],
  providers: [SingletonCronRunner, GeoIpUpdateService],
})
class GeoIpCliModule {}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(GeoIpCliModule)
  try {
    await app.get(GeoIpUpdateService).runGuarded()
    const epoch = app.get(GeoIpService).currentBuildEpoch()
    if (
      app.get(EnvService).get('GEOIP_ENABLED') &&
      (!epoch || currentEdition(epoch) !== currentEdition())
    ) {
      process.exitCode = 1
    }
  } finally {
    await app.close()
  }
}

void main().catch(() => {
  process.exitCode = 1
})
