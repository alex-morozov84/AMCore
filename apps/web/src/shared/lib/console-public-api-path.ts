import { ADMIN_CONSOLE_CONFIG } from './admin-console.generated'

/**
 * Maps a physical console BFF suffix (always `app/api/console/**`,
 * regardless of topology — see `docs/operations-console/configuration.md`
 * → "Choose the topology once") to its current public same-origin path.
 *
 * Path mode's Next.js app serves the product's own `/api/*` too, so the
 * `/console` prefix is what actually selects the console's handler. Host
 * mode's edge Caddy config (`docker/caddy/Caddyfile.console-host`) rewrites
 * every public `/api/*` request on the console hostname to `/api/console/*`
 * before it ever reaches this app, so the public path a browser fetches
 * there is the unprefixed suffix — prefixing it here as well would ask
 * Caddy to rewrite a path that was already rewritten once.
 */
export function getConsolePublicApiPath(path: `/${string}`): string {
  return ADMIN_CONSOLE_CONFIG.mode === 'host' ? path : `/console${path}`
}
