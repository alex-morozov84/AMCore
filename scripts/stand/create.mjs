import { closedSignupOAuthProfile, prepareAppleOAuthFixture } from './apple-oauth-fixture.mjs'
import { readMockTls } from './mock-tls.mjs'
import { assertPreserveRequest, recordSettings, sourceSettings } from './settings-policy.mjs'
import { prepareProductAdminSource, productAdminProfiles } from './product-admin-source.mjs'
import { setConsoleMode } from './console-mode.mjs'
import { operatorMfaWanted } from './operator-mfa.mjs'
import { prepareAccountMfaPreview } from './account-mfa-source.mjs'
import { projectChoices } from './project.mjs'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { join } from 'node:path'
import { root, directory, save } from './state.mjs'
import { snapshot } from './snapshot.mjs'
import { allocate } from './ports.mjs'
import { engine } from './docker.mjs'
import {
  assertOrganizationSetupFixture,
  isOrganizationMailFixture,
  prepareOrganizationSetupSource,
} from './organization-setup-fixture.mjs'

export async function create(
  id,
  purpose,
  topology,
  mocked = false,
  fixtureProfile,
  onAllocated,
  settingsPolicy = 'variant'
) {
  const choices = await projectChoices(root)
  assertPreserveRequest(settingsPolicy, fixtureProfile, topology, choices)
  if (
    fixtureProfile === closedSignupOAuthProfile &&
    (purpose !== 'e2e' ||
      mocked ||
      topology !== 'host' ||
      !choices.consoleEnabled ||
      choices.consoleTopology !== 'host')
  )
    throw new Error('Closed signup OAuth fixture requires an owned host Console E2E stand')
  const originalSettings = await sourceSettings(root)
  const pathOAuth = fixtureProfile === 'product-admin-oauth-path'
  const consoleSummary = fixtureProfile === 'console-summary'
  if (pathOAuth && !choices.consoleEnabled)
    throw new Error('Path OAuth HTTPS fixture requires the enabled Console rehearsal')
  const productAdminHost =
    !pathOAuth &&
    !consoleSummary &&
    (choices.productAdminHost || productAdminProfiles.includes(fixtureProfile))
  let consoleTopology =
    fixtureProfile === 'product-admin-three-host' ? 'host' : choices.consoleTopology
  if (['support-mail-path', 'support-mail-host'].includes(fixtureProfile)) {
    if (!choices.consoleEnabled) throw new Error('Support mail E2E requires enabled Console')
    consoleTopology = fixtureProfile === 'support-mail-host' ? 'host' : 'path'
  }
  if (consoleSummary) consoleTopology = 'path'
  topology ??= consoleSummary ? 'path' : pathOAuth || productAdminHost ? 'host' : choices.topology
  if (productAdminHost && topology !== 'host')
    throw new Error('Staff rehearsal requires HTTPS transport')
  const mockTls =
    mocked && topology === 'host' ? await readMockTls(process.env.AMCORE_MOCK_TLS_DIR) : undefined
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
  if (
    consoleSummary &&
    (purpose !== 'e2e' || mocked || topology !== 'path' || !choices.consoleEnabled)
  )
    throw new Error('Console summary fixture requires isolated path E2E')
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
  if (consoleSummary) origins.metrics = `http://127.0.0.1:${ports.tls}`
  if (mockTls) {
    hostnames.product = 'app.mocked.localhost'
    origins.product = `https://${hostnames.product}:${ports.web}`
    if (productAdminHost) {
      hostnames.staff = 'staff.app.mocked.localhost'
      origins.staff = `https://${hostnames.staff}:${ports.web}`
    }
    if (consoleTopology === 'host' && choices.consoleEnabled) {
      hostnames.console = 'console.app.mocked.localhost'
      origins.console = `https://${hostnames.console}:${ports.web}`
    } else delete origins.console
  } else if (mocked) {
    origins.product = `http://127.0.0.1:${ports.web}`
    delete origins.console
  }
  if (mocked) delete origins.api
  const m = {
    version: 1,
    settingsPolicy,
    sourceSettings: originalSettings,
    ...choices,
    productAdminHost,
    consoleTopology,
    fixtureVersion: 2,
    fixtureProfile,
    operatorMfa: operatorMfaWanted({
      purpose,
      mocked,
      consoleEnabled: choices.consoleEnabled,
      consoleTopology,
      fixtureProfile,
    }),
    ...(isOrganizationMailFixture({ fixtureProfile })
      ? { mailCaptureKey: randomBytes(32).toString('hex') }
      : {}),
    mocked,
    ...(mockTls ? { mockTls } : {}),
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
  if (consoleSummary)
    await setConsoleMode(m.snapshot, 'path', 'Console summary fixture requires enabled Console')
  if (['support-mail-path', 'support-mail-host'].includes(fixtureProfile)) {
    await setConsoleMode(m.snapshot, consoleTopology, 'Support mail Console disabled')
  }
  if (
    settingsPolicy !== 'preserve' &&
    topology === 'host' &&
    (!productAdminHost || (choices.consoleEnabled && consoleTopology === 'host'))
  ) {
    await setConsoleMode(m.snapshot, 'host', 'Console host lane unavailable in this fork')
  }
  await prepareProductAdminSource(m)
  if (fixtureProfile === closedSignupOAuthProfile && !productAdminHost)
    await prepareAppleOAuthFixture(m)
  await prepareAccountMfaPreview(m)
  await recordSettings(m)
  await save(m)
  return m
}
