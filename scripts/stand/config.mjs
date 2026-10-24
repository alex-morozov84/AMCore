import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash, createHmac } from 'node:crypto'
import { parse, stringify } from 'yaml'
import { compose } from './docker.mjs'
import { setupMailCollectorService } from './setup-mail-collector.mjs'
import {
  assertOrganizationSetupFixture,
  isOrganizationMailFixture,
  usesResendMailFixture,
} from './organization-setup-fixture.mjs'
import { directory } from './state.mjs'
import { appleOAuthEnvironment, assertAppleOAuthFixture } from './apple-oauth-fixture.mjs'

export const label = 'org.amcore.stand'
// Services whose images the stand builds itself. Only these carry ownership labels on
// the built image (`build.labels`); pulled images (postgres, redis, caddy) never do.
export const builtServices = ['migrate', 'seed', 'api', 'worker', 'web']
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
  assertOrganizationSetupFixture(m)
  const db = `postgresql://amcore:${m.dbPassword}@postgres:5432/amcore`
  const closedCreationProfiles = ['organization-shop']
  // AMCORE_CONSOLE_ESTABLISHMENT_POLICY_START
  closedCreationProfiles.push('organization-establishment')
  // AMCORE_CONSOLE_ESTABLISHMENT_POLICY_END
  // Optional SEO scenarios (docs/frontend/seo.md): set these in the shell that runs the stand
  // command to start the web service open to search engines. Empty means the default closed site.
  // The site origin must be https and trusted, so it is added to the trusted origins below.
  const siteOrigin = process.env.AMCORE_STAND_WEB_SITE_ORIGIN ?? ''
  const seoIndexing = process.env.AMCORE_STAND_WEB_SEO_INDEXING ?? ''
  const app = {
    NODE_ENV: 'development',
    API_PORT: '5002',
    DATABASE_URL: db,
    REDIS_URL: 'redis://redis:6379',
    JWT_SECRET: m.jwtSecret,
    GEOIP_ENABLED: 'false',
    STORAGE_DRIVER: 'local',
    // The browser-facing API origin of this stand, so a public avatar URL resolves.
    ...(m.origins.api && { STORAGE_PUBLIC_BASE_URL: `${m.origins.api}/api/v1/storage/public` }),
    EMAIL_PROVIDER: 'mock',
    AUTH_PUBLIC_SIGNUP_ENABLED: isOrganizationMailFixture(m) ? 'false' : 'true',
    ORG_SELF_SERVICE_CREATION_ENABLED:
      isOrganizationMailFixture(m) || closedCreationProfiles.includes(m.fixtureProfile)
        ? 'false'
        : 'true',
    ...(isOrganizationMailFixture(m) ? { AMCORE_SETUP_MAIL_CAPTURE_KEY: m.mailCaptureKey } : {}),
    FRONTEND_URL: m.origins.product,
    PRODUCT_ADMIN_ORIGIN: m.origins.staff ?? '',
    WEB_FRONTEND_CONTEXT_KEY: createHmac('sha256', m.jwtSecret)
      .update('amcore-web-context-v1')
      .digest('hex'),
    CORS_ORIGIN: Object.values(m.origins).join(','),
    TRUST_PROXY: m.topology === 'host' ? '1' : 'false',
  }
  if (usesResendMailFixture(m))
    Object.assign(app, {
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: '<fake-e2e-provider-key>',
    })
  // AMCORE_CONSOLE_NOTIFICATION_ENV_START
  if (m.fixtureProfile === 'notification-work')
    Object.assign(app, {
      TELEGRAM_BOT_TOKEN: '<fake-preview-token>',
      TELEGRAM_API_BASE_URL: 'http://notification-provider:8099',
    })
  // AMCORE_CONSOLE_NOTIFICATION_ENV_END
  const environments = {
    postgres: { POSTGRES_USER: 'amcore', POSTGRES_DB: 'amcore', POSTGRES_PASSWORD: m.dbPassword },
    redis: {},
    migrate: { DATABASE_URL: db, E2E_DATABASE_URL: db },
    seed: { DATABASE_URL: db },
    api: { ...app, PROCESS_ROLE: 'web' },
    worker: { ...app, PROCESS_ROLE: 'worker' },
    web: {
      FRONTEND_URL: m.origins.product,
      PRODUCT_ADMIN_ORIGIN: m.origins.staff ?? '',
      WEB_FRONTEND_CONTEXT_KEY: app.WEB_FRONTEND_CONTEXT_KEY,
      NODE_ENV: 'production',
      API_URL: 'http://api:5002',
      REDIS_URL: 'redis://redis:6379',
      WEB_TRUSTED_ORIGINS: [m.origins.product, m.origins.staff, siteOrigin]
        .filter(Boolean)
        .join(','),
      WEB_SITE_ORIGIN: siteOrigin,
      WEB_SEO_INDEXING: seoIndexing,
      // The stand's API serves public files, so its origin may load images.
      WEB_PUBLIC_FILES_ORIGIN: m.origins.api ?? '',
      WEB_INVITATION_LOCAL_HTTP_ORIGIN: m.origins.product.startsWith('http:')
        ? m.origins.product
        : '',
      // AMCORE_CONSOLE_WEB_ENV_START
      ADMIN_CONSOLE_HOSTNAME: m.hostnames.console ?? '',
      ADMIN_CONSOLE_ORIGIN: m.origins.console ?? '',
      // External tool links for the Overview card; empty unless the CLI shell sets them.
      ADMIN_CONSOLE_METRICS_URL: process.env.AMCORE_STAND_CONSOLE_METRICS_URL ?? '',
      ADMIN_CONSOLE_LOGS_URL: process.env.AMCORE_STAND_CONSOLE_LOGS_URL ?? '',
      ADMIN_CONSOLE_ALERTS_URL: process.env.AMCORE_STAND_CONSOLE_ALERTS_URL ?? '',
      ADMIN_CONSOLE_LOGS_GRAFANA_URL: process.env.AMCORE_STAND_CONSOLE_LOGS_GRAFANA_URL ?? '',
      // AMCORE_CONSOLE_WEB_ENV_END
    },
  }
  // AMCORE_CONSOLE_NOTIFICATION_PROVIDER_START
  let fixtureService
  if (m.fixtureProfile === 'notification-work') {
    if (!m.consoleEnabled) throw new Error('Notification work preview requires Console')
    const { notificationProviderService } = await import('./notification-work-provider.mjs')
    fixtureService = notificationProviderService(m)
    environments['notification-provider'] = {}
  }
  // AMCORE_CONSOLE_NOTIFICATION_PROVIDER_END
  if (isOrganizationMailFixture(m))
    environments['mail-capture'] = { AMCORE_SETUP_MAIL_CAPTURE_KEY: m.mailCaptureKey }
  if (m.productAdminHost)
    environments.caddy = {
      CADDY_DOMAIN: m.hostnames.api,
      CADDY_WEB_DOMAIN: m.hostnames.product,
      PRODUCT_ADMIN_HOSTNAME: m.hostnames.staff,
      CADDY_EMAIL: 'stand@example.invalid',
    }
  // AMCORE_CONSOLE_CADDY_ENV_START
  if (m.topology === 'host' && !m.productAdminHost)
    environments.caddy = {
      CADDY_DOMAIN: m.hostnames.api,
      CADDY_WEB_DOMAIN: m.hostnames.product,
      ADMIN_CONSOLE_HOSTNAME: m.hostnames.console,
      CADDY_EMAIL: 'stand@example.invalid',
    }
  if (m.productAdminHost && m.consoleEnabled && m.consoleTopology === 'host')
    environments.caddy.ADMIN_CONSOLE_HOSTNAME = m.hostnames.console
  // AMCORE_CONSOLE_CADDY_ENV_END
  const ports = {
    postgres: [],
    redis: [`127.0.0.1:${m.ports.redis}:6379`],
    api: [`127.0.0.1:${m.ports.api}:5002`],
    web: [`127.0.0.1:${m.ports.web}:3000`],
    caddy: [`127.0.0.1:${m.ports.tls}:443`],
  }
  Object.assign(environments.api, await appleOAuthEnvironment(m))
  let yaml = 'services:\n'
  for (const [service, environment] of Object.entries(environments)) {
    yaml += `  ${service}:\n    environment: ${overridden(environment)}\n    labels:\n${labelLines(m, '      ')}`
    if (builtServices.includes(service))
      yaml += `    build:\n      labels:\n${labelLines(m, '        ')}`
    if (service === 'seed')
      yaml +=
        `      context: ${JSON.stringify(m.snapshot)}\n      dockerfile: apps/api/Dockerfile\n      target: build\n` +
        `    working_dir: /app/apps/api\n    user: node\n    init: true\n    restart: 'no'\n` +
        `    command: ['./node_modules/.bin/tsx', 'prisma/seed.ts']\n`
    if (m.images?.[service]) yaml += `    image: ${m.images[service]}\n`
    // AMCORE_CONSOLE_NOTIFICATION_SERVICE_START
    if (service === 'notification-provider')
      yaml += stringify({ services: { [service]: fixtureService } })
        .replace(/^services:\n/, '')
        .split('\n')
        .slice(1)
        .join('\n')
    // AMCORE_CONSOLE_NOTIFICATION_SERVICE_END
    if (service === 'mail-capture')
      yaml += stringify({ services: { [service]: setupMailCollectorService(m) } })
        .replace(/^services:\n/, '')
        .split('\n')
        .slice(1)
        .join('\n')
    if (ports[service]) yaml += `    ports: ${overridden(ports[service])}\n`
    if (
      service === 'api' &&
      ['product-admin-oauth', 'product-admin-oauth-path'].includes(m.fixtureProfile)
    )
      yaml += `    volumes:\n      - ${JSON.stringify(`${m.snapshot}/docker/testing/apple-oidc.mjs:/app/fixtures/apple-oidc.mjs:ro`)}\n`
  }
  const base = parse(await readFile(join(m.snapshot, 'docker-compose.yml'), 'utf8'))
  // AMCORE_CONSOLE_NOTIFICATION_VOLUME_START
  if (m.fixtureProfile === 'notification-work') base.volumes.notification_provider_data = {}
  // AMCORE_CONSOLE_NOTIFICATION_VOLUME_END
  yaml += stringify({
    networks: { default: { labels: labels(m) } },
    volumes: Object.fromEntries(
      Object.keys(base.volumes).map((key) => [key, { labels: labels(m) }])
    ),
  })
  m.envFile = join(directory(m.id), 'compose.env')
  m.overlay = join(directory(m.id), 'managed.yml')
  const envLines = [
    `WEB_FRONTEND_CONTEXT_KEY=${app.WEB_FRONTEND_CONTEXT_KEY}`,
    'COMPOSE_PROFILES=',
    `CADDY_WEB_DOMAIN=${m.hostnames.product}`,
    ...(m.productAdminHost ? [`PRODUCT_ADMIN_HOSTNAME=${m.hostnames.staff}`] : []),
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
  assertOrganizationSetupFixture(m)
  assertAppleOAuthFixture(m)
  const collector = m.model.services['mail-capture']
  if (isOrganizationMailFixture(m)) {
    if (
      !collector ||
      collector.image !== `${m.project}-api:latest` ||
      collector.ports?.length ||
      collector.volumes?.length ||
      collector.environment?.AMCORE_SETUP_MAIL_CAPTURE_KEY !== m.mailCaptureKey
    )
      throw new Error('Unsafe setup mail collector')
    for (const name of ['api', 'worker']) {
      const environment = m.model.services[name].environment
      if (
        usesResendMailFixture(m) &&
        (environment.NODE_ENV !== 'development' ||
          environment.EMAIL_PROVIDER !== 'resend' ||
          environment.RESEND_API_KEY !== '<fake-e2e-provider-key>')
      )
        throw new Error('Provisioning fixture mail policy changed')
      if (
        environment.AUTH_PUBLIC_SIGNUP_ENABLED !== 'false' ||
        environment.ORG_SELF_SERVICE_CREATION_ENABLED !== 'false' ||
        environment.AMCORE_SETUP_MAIL_CAPTURE_KEY !== m.mailCaptureKey
      )
        throw new Error('Setup fixture policy changed')
    }
  } else if (collector) throw new Error('Unexpected setup mail collector')
  if (m.fixtureProfile === 'organization-shop') {
    for (const name of ['api', 'worker']) {
      const environment = m.model.services[name].environment
      if (
        environment.AUTH_PUBLIC_SIGNUP_ENABLED !== 'true' ||
        environment.ORG_SELF_SERVICE_CREATION_ENABLED !== 'false'
      )
        throw new Error('Shop fixture policy changed')
    }
  }
  if (!/^[0-9a-f]{48}$/.test(m.dbPassword) || !/^[0-9a-f]{64}$/.test(m.jwtSecret))
    throw new Error('Invalid local credential encoding')
  const ports = Object.values(m.ports)
  if (
    new Set(ports).size !== ports.length ||
    ports.some((p) => !Number.isInteger(p) || p < 20000 || p > 44999)
  )
    throw new Error('Invalid managed ports')
  const suffix = m.uuid.replaceAll('-', '').slice(0, 12)
  const expectedNames = [
    'api',
    'console',
    'product',
    ...(m.productAdminHost ? ['staff'] : []),
  ].sort()
  if (Object.keys(m.hostnames).sort().join(',') !== expectedNames.join(','))
    throw new Error('Foreign stand hostname inventory')
  for (const [key, prefix] of [
    ['product', 'app'],
    ['console', 'console'],
    ['api', 'api'],
  ]) {
    const expected =
      m.productAdminHost && key !== 'product'
        ? `${prefix}.${m.hostnames.product}`
        : `${prefix}-${suffix}.localhost`
    if (m.hostnames[key] !== expected) throw new Error('Foreign stand hostname')
  }
  if (m.productAdminHost && m.hostnames.staff !== `staff.${m.hostnames.product}`)
    throw new Error('Foreign staff hostname')
  const wantedOrigins =
    m.topology === 'host'
      ? Object.fromEntries(
          Object.entries(m.hostnames).map(([key, host]) => [key, `https://${host}:${m.ports.tls}`])
        )
      : {
          product: `http://${m.hostnames.product}:${m.ports.web}`,
          api: `http://127.0.0.1:${m.ports.api}`,
        }
  if (m.productAdminHost && (!m.consoleEnabled || m.consoleTopology !== 'host'))
    delete wantedOrigins.console
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
  const seed = m.model.services.seed
  if (
    seed?.build?.target !== 'build' ||
    seed.build.dockerfile !== 'apps/api/Dockerfile' ||
    seed.working_dir !== '/app/apps/api' ||
    seed.user !== 'node' ||
    seed.init !== true ||
    seed.restart !== 'no' ||
    JSON.stringify(seed.command) !==
      JSON.stringify(['./node_modules/.bin/tsx', 'prisma/seed.ts']) ||
    seed.ports?.length ||
    seed.volumes?.length
  )
    throw new Error('Unsafe managed seed service')
  for (const name of ['api', 'worker', 'migrate', 'seed'])
    if (m.model.services[name].environment.DATABASE_URL !== db) throw new Error('Foreign DB target')
  if (m.model.services.migrate.environment.E2E_DATABASE_URL !== db)
    throw new Error('Migration URL mismatch')
  for (const name of ['api', 'worker', 'web'])
    if (m.model.services[name].environment.REDIS_URL !== 'redis://redis:6379')
      throw new Error('Foreign Redis target')
  if (m.model.services.web.environment.API_URL !== 'http://api:5002')
    throw new Error('Foreign API target')
  const invitationHttpOrigin = m.origins.product.startsWith('http:') ? m.origins.product : ''
  if (m.model.services.web.environment.WEB_INVITATION_LOCAL_HTTP_ORIGIN !== invitationHttpOrigin)
    throw new Error('Foreign invitation HTTP origin')
}
