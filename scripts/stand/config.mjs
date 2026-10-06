import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { parse, stringify } from 'yaml'
import { compose } from './docker.mjs'
import { directory } from './state.mjs'

export const label = 'org.amcore.stand'
// Services whose images the stand builds itself. Only these carry ownership labels on
// the built image (`build.labels`); pulled images (postgres, redis, caddy) never do.
export const builtServices = ['migrate', 'api', 'worker', 'web']
export function labels(m) {
  return { [label]: m.uuid, 'org.amcore.attempt': m.attempt, 'org.amcore.worktree': m.worktree }
}
const labelLines = (m, pad) =>
  stringify(labels(m))
    .split('\n')
    .filter(Boolean)
    .map((l) => `${pad}${l}\n`)
    .join('')
const overridden = (value) =>
  `!override\n      ${stringify(value).trimEnd().replaceAll('\n', '\n      ')}`

export async function configuration(m) {
  const db = `postgresql://amcore:${m.dbPassword}@postgres:5432/amcore`
  const app = {
    NODE_ENV: 'development',
    API_PORT: '5002',
    DATABASE_URL: db,
    REDIS_URL: 'redis://redis:6379',
    JWT_SECRET: m.jwtSecret,
    GEOIP_ENABLED: 'false',
    STORAGE_DRIVER: 'local',
    EMAIL_PROVIDER: 'mock',
    FRONTEND_URL: m.origins.product,
    CORS_ORIGIN: Object.values(m.origins).join(','),
    TRUST_PROXY: m.topology === 'host' ? '1' : 'false',
  }
  const environments = {
    postgres: { POSTGRES_USER: 'amcore', POSTGRES_DB: 'amcore', POSTGRES_PASSWORD: m.dbPassword },
    redis: {},
    migrate: { DATABASE_URL: db, E2E_DATABASE_URL: db },
    api: { ...app, PROCESS_ROLE: 'web' },
    worker: { ...app, PROCESS_ROLE: 'worker' },
    web: {
      NODE_ENV: 'production',
      API_URL: 'http://api:5002',
      REDIS_URL: 'redis://redis:6379',
      WEB_TRUSTED_ORIGINS: m.origins.product,
      // AMCORE_CONSOLE_WEB_ENV_START
      ADMIN_CONSOLE_HOSTNAME: m.hostnames.console ?? '',
      ADMIN_CONSOLE_ORIGIN: m.origins.console ?? '',
      // AMCORE_CONSOLE_WEB_ENV_END
    },
  }
  // AMCORE_CONSOLE_CADDY_ENV_START
  if (m.topology === 'host')
    environments.caddy = {
      CADDY_DOMAIN: m.hostnames.api,
      CADDY_WEB_DOMAIN: m.hostnames.product,
      ADMIN_CONSOLE_HOSTNAME: m.hostnames.console,
      CADDY_EMAIL: 'stand@example.invalid',
    }
  // AMCORE_CONSOLE_CADDY_ENV_END
  const ports = {
    postgres: [],
    redis: [`127.0.0.1:${m.ports.redis}:6379`],
    api: [`127.0.0.1:${m.ports.api}:5002`],
    web: [`127.0.0.1:${m.ports.web}:3000`],
    caddy: [`127.0.0.1:${m.ports.tls}:443`],
  }
  let yaml = 'services:\n'
  for (const [service, environment] of Object.entries(environments)) {
    yaml += `  ${service}:\n    environment: ${overridden(environment)}\n    labels:\n${labelLines(m, '      ')}`
    if (builtServices.includes(service))
      yaml += `    build:\n      labels:\n${labelLines(m, '        ')}`
    if (m.images?.[service]) yaml += `    image: ${m.images[service]}\n`
    if (ports[service]) yaml += `    ports: ${overridden(ports[service])}\n`
  }
  const base = parse(await readFile(join(m.snapshot, 'docker-compose.yml'), 'utf8'))
  yaml += stringify({
    networks: { default: { labels: labels(m) } },
    volumes: Object.fromEntries(
      Object.keys(base.volumes).map((key) => [key, { labels: labels(m) }])
    ),
  })
  m.envFile = join(directory(m.id), 'compose.env')
  m.overlay = join(directory(m.id), 'managed.yml')
  const envLines = [
    'COMPOSE_PROFILES=',
    `CADDY_WEB_DOMAIN=${m.hostnames.product}`,
    // AMCORE_CONSOLE_COMPOSE_ENV_START
    `ADMIN_CONSOLE_HOSTNAME=${m.topology === 'host' ? m.hostnames.console : ''}`,
    // AMCORE_CONSOLE_COMPOSE_ENV_END
    `CADDY_DOMAIN=${m.hostnames.api}`,
    'CADDY_EMAIL=stand@example.invalid',
  ]
  await writeFile(m.envFile, envLines.join('\n') + '\n', { mode: 0o600 })
  await writeFile(m.overlay, yaml, { mode: 0o600 })
  m.services = Object.keys(environments)
  const rendered = await compose(m, ['config', '--format', 'json'], { capture: true })
  m.model = JSON.parse(rendered)
  validateModel(m)
  m.configHash = createHash('sha256').update(rendered).digest('hex')
}

export function validateModel(m) {
  if (!/^[0-9a-f]{48}$/.test(m.dbPassword) || !/^[0-9a-f]{64}$/.test(m.jwtSecret))
    throw new Error('Invalid local credential encoding')
  const ports = Object.values(m.ports)
  if (
    new Set(ports).size !== ports.length ||
    ports.some((p) => !Number.isInteger(p) || p < 20000 || p > 44999)
  )
    throw new Error('Invalid managed ports')
  const suffix = m.uuid.replaceAll('-', '').slice(0, 12)
  for (const [key, prefix] of [
    ['product', 'app'],
    ['console', 'console'],
    ['api', 'api'],
  ]) {
    if (m.hostnames[key] !== `${prefix}-${suffix}.localhost`)
      throw new Error('Foreign stand hostname')
  }
  const wantedOrigins =
    m.topology === 'host'
      ? Object.fromEntries(
          Object.entries(m.hostnames).map(([key, host]) => [key, `https://${host}:${m.ports.tls}`])
        )
      : {
          product: `http://${m.hostnames.product}:${m.ports.web}`,
          api: `http://127.0.0.1:${m.ports.api}`,
        }
  if (JSON.stringify(m.origins) !== JSON.stringify(wantedOrigins))
    throw new Error('Foreign stand origin')
  for (const [name, key, target] of [
    ['web', 'web', 3000],
    ['api', 'api', 5002],
    ['redis', 'redis', 6379],
    ...(m.topology === 'host' ? [['caddy', 'tls', 443]] : []),
  ]) {
    const published = m.model.services[name].ports
    if (
      published?.length !== 1 ||
      Number(published[0].published) !== m.ports[key] ||
      published[0].target !== target
    )
      throw new Error('Endpoint/config port mismatch')
  }

  for (const name of m.services) {
    const s = m.model.services[name]
    if (!s || s.labels?.[label] !== m.uuid || s.network_mode || s.env_file || s.extra_hosts)
      throw new Error(`Unsafe ${name} config`)
    for (const port of s.ports ?? [])
      if (port.host_ip !== '127.0.0.1') throw new Error('Non-loopback publication')
    if (name === 'postgres' && s.ports?.length) throw new Error('Postgres publication refused')
    for (const mount of s.volumes ?? [])
      if (mount.type === 'bind' && !mount.source.startsWith(`${m.snapshot}/docker/`))
        throw new Error('Foreign bind mount')
    if (s.build?.context && s.build.context !== m.snapshot) throw new Error('Foreign build root')
    // Built images must carry the full ownership tuple so disposal can prove them;
    // no other service may claim build labels.
    const built = Object.entries(labels(m)).every(
      ([key, value]) => s.build?.labels?.[key] === value
    )
    if (builtServices.includes(name) ? !built : s.build?.labels)
      throw new Error(`Unowned ${name} image labels`)
  }
  for (const resource of [...Object.values(m.model.volumes), ...Object.values(m.model.networks)]) {
    if (
      resource.external ||
      resource.labels?.[label] !== m.uuid ||
      !resource.name.startsWith(`${m.project}_`)
    )
      throw new Error('Unscoped resource')
  }
  const db = `postgresql://amcore:${m.dbPassword}@postgres:5432/amcore`
  for (const name of ['api', 'worker', 'migrate'])
    if (m.model.services[name].environment.DATABASE_URL !== db) throw new Error('Foreign DB target')
  if (m.model.services.migrate.environment.E2E_DATABASE_URL !== db)
    throw new Error('Migration URL mismatch')
  for (const name of ['api', 'worker', 'web'])
    if (m.model.services[name].environment.REDIS_URL !== 'redis://redis:6379')
      throw new Error('Foreign Redis target')
  if (m.model.services.web.environment.API_URL !== 'http://api:5002')
    throw new Error('Foreign API target')
}
