import { prepareProductAdminSource, productAdminProfiles } from './product-admin-source.mjs'
import { projectChoices } from './project.mjs'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { join } from 'node:path'
// AMCORE_CONSOLE_HOST_IMPORTS_START
import { readFile, writeFile } from 'node:fs/promises'
// AMCORE_CONSOLE_HOST_IMPORTS_END
import { root, directory, save } from './state.mjs'
import { snapshot } from './snapshot.mjs'
import { allocate } from './ports.mjs'
import { engine } from './docker.mjs'
import {
  assertOrganizationSetupFixture,
  prepareOrganizationSetupSource,
} from './organization-setup-fixture.mjs'

export async function create(id, purpose, topology, mocked = false, fixtureProfile, onAllocated) {
  const choices = await projectChoices(root)
  const pathOAuth = fixtureProfile === 'product-admin-oauth-path'
  if (pathOAuth && !choices.consoleEnabled)
    throw new Error('Path OAuth HTTPS fixture requires the enabled Console rehearsal')
  const productAdminHost =
    !pathOAuth && (choices.productAdminHost || productAdminProfiles.includes(fixtureProfile))
  const consoleTopology =
    fixtureProfile === 'support-mail-path'
      ? 'path'
      : ['product-admin-three-host', 'support-mail-host'].includes(fixtureProfile)
        ? 'host'
        : choices.consoleTopology
  topology ??= pathOAuth ? 'host' : productAdminHost ? 'host' : choices.topology
  if (productAdminHost && topology !== 'host')
    throw new Error('Staff rehearsal requires HTTPS transport')
  if (
    ['support-mail-path', 'support-mail-host'].includes(fixtureProfile) &&
    !choices.consoleEnabled
  )
    throw new Error('Support mail E2E requires enabled Console')
  const uuid = randomUUID()
  const attempt = randomUUID()
  const suffix = uuid.replaceAll('-', '').slice(0, 12)
  const hostnames = {
    product: `app-${suffix}.localhost`,
    console: `console-${suffix}.localhost`,
    api: `api-${suffix}.localhost`,
  }
  if (productAdminHost) {
    // Separate host-only cookies, with the same site relationship as manage.shop.example.
    hostnames.staff = `staff.${hostnames.product}`
    hostnames.console = `console.${hostnames.product}`
    hostnames.api = `api.${hostnames.product}`
  }
  const ports = await allocate(uuid)
  const origins =
    topology === 'host'
      ? Object.fromEntries(
          Object.entries(hostnames).map(([k, v]) => [k, `https://${v}:${ports.tls}`])
        )
      : {
          product: mocked
            ? `http://127.0.0.1:${ports.web}`
            : `http://${hostnames.product}:${ports.web}`,
          api: `http://127.0.0.1:${ports.api}`,
        }
  if (productAdminHost && (consoleTopology !== 'host' || !choices.consoleEnabled))
    delete origins.console
  if (mocked) {
    origins.product = `http://127.0.0.1:${ports.web}`
    delete origins.api
    delete origins.console
  }
  const m = {
    version: 1,
    ...choices,
    productAdminHost,
    consoleTopology,
    fixtureVersion: 2,
    fixtureProfile,
    ...([
      'organization-setup',
      'organization-provisioning',
      'product-admin-closed-signup',
      'support-mail-path',
      'support-mail-host',
    ].includes(fixtureProfile)
      ? { mailCaptureKey: randomBytes(32).toString('hex') }
      : {}),
    mocked,
    id,
    uuid,
    attempt,
    purpose,
    topology,
    worktree: root,
    project: `amcore-${createHash('sha256').update(root).digest('hex').slice(0, 8)}-${purpose}-${suffix}`,
    engine: mocked ? undefined : await engine(),
    ports,
    hostnames,
    origins,
    dbPassword: randomBytes(24).toString('hex'),
    jwtSecret: randomBytes(32).toString('hex'),
    snapshot: join(directory(id), `source-${attempt}`),
    state: 'allocated',
    resources: {},
  }
  assertOrganizationSetupFixture(m)
  await save(m)
  // Retain cleanup ownership before snapshot preparation can fail or be interrupted.
  onAllocated?.(m)
  m.sourceHash = await snapshot(root, m.snapshot)
  await prepareOrganizationSetupSource(m)
  // AMCORE_CONSOLE_HOST_SNAPSHOT_START
  if (['support-mail-path', 'support-mail-host'].includes(fixtureProfile)) {
    const file = join(m.snapshot, 'apps/web/src/shared/lib/admin-console.generated.ts')
    const value = await readFile(file, 'utf8')
    if (!value.includes('enabled: true')) throw new Error('Support mail Console disabled')
    await writeFile(file, value.replace(/mode: '(?:path|host)'/, `mode: '${consoleTopology}'`))
  }
  if (
    topology === 'host' &&
    (!productAdminHost || (choices.consoleEnabled && consoleTopology === 'host'))
  ) {
    const path = join(m.snapshot, 'apps/web/src/shared/lib/admin-console.generated.ts')
    const content = await readFile(path, 'utf8')
    if (!content.includes('enabled: true'))
      throw new Error('Console host lane unavailable in this fork')
    await writeFile(path, content.replace(/mode: '(?:path|host)'/, `mode: '${consoleTopology}'`))
  }
  // AMCORE_CONSOLE_HOST_SNAPSHOT_END
  await prepareProductAdminSource(m)
  await save(m)
  return m
}
