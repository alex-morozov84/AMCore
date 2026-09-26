import { z } from 'zod'

// Approximate IP-to-location lookup for the Console/Settings sessions panels
// Enabled by default — see `docs/operations/geoip-setup.md`. The
// updater only runs in the worker/all process role (`ScheduleModule` is not
// imported by `web`); `GEOIP_DB_PATH` still needs to resolve to the same
// shared volume from every process role that reads it.
// Enum-transform rather than z.coerce.boolean() — the latter treats 'false' as true.
export const geoipEnv = z.object({
  GEOIP_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  GEOIP_DB_PATH: z.string().default('/data/geoip/dbip-city-lite.mmdb'),
})
