import { GeoIpService } from '../../../src/infrastructure/geoip/geoip.service'

const path = process.argv[2]!
const service = new GeoIpService(
  { get: (key: string) => (key === 'GEOIP_ENABLED' ? true : path) } as never,
  { setContext: () => undefined, info: () => undefined, warn: () => undefined } as never
)
void service
  .onModuleInit()
  .then(() => process.send?.({ ready: true, location: service.resolve('81.2.69.142', 'ru') }))
process.on('message', async () => {
  await service.checkGeneration()
  process.send?.({ location: service.resolve('81.2.69.142', 'ru') })
})
