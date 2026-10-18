import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  assertOrganizationSetupFixture,
  prepareOrganizationSetupSource,
} from './organization-setup-fixture.mjs'
import { mailCollectorProgram, setupMailCollectorService } from './setup-mail-collector.mjs'
import { executeSetupCommand } from './setup-command.mjs'
import { standReporters } from '../../apps/web/e2e/support/managed-target.mjs'

test('shop fixture is Docker E2E only and cannot use initial-account mutation helpers', async () => {
  assert.doesNotThrow(() =>
    assertOrganizationSetupFixture({
      fixtureProfile: 'organization-shop',
      purpose: 'e2e',
      mocked: false,
    })
  )
  for (const manifest of [{ purpose: 'preview' }, { purpose: 'e2e', mocked: true }])
    assert.throws(
      () => assertOrganizationSetupFixture({ fixtureProfile: 'organization-shop', ...manifest }),
      /fresh Docker E2E/
    )
  for (const command of ['prepare-account', 'bootstrap', 'diagnostics'])
    await assert.rejects(
      executeSetupCommand({ fixtureProfile: 'organization-shop', purpose: 'e2e' }, { command }),
      /Wrong setup fixture/
    )
})

test('rendered secret-link fixture has no artifact reporter or printed API steps', () => {
  assert.deepEqual(standReporters({ fixtureProfile: 'organization-setup' }, '/owned/fixture'), [
    ['list', { printSteps: false }],
  ])
  assert.deepEqual(
    standReporters({}, '/owned/ordinary').map(([name]) => name),
    ['list', 'html']
  )
})

test('setup mail fixture refuses preview, mock and missing credentials; collector publishes no port or volume', () => {
  const valid = {
    purpose: 'e2e',
    mocked: false,
    fixtureProfile: 'organization-setup',
    mailCaptureKey: 'a'.repeat(64),
    project: 'owned',
  }
  assert.doesNotThrow(() => assertOrganizationSetupFixture(valid))
  for (const override of [{ purpose: 'preview' }, { mocked: true }, { mailCaptureKey: '' }])
    assert.throws(() => assertOrganizationSetupFixture({ ...valid, ...override }))
  const service = setupMailCollectorService(valid)
  assert.equal(service.ports, undefined)
  assert.equal(service.volumes, undefined)
  assert.equal(service.image, 'owned-api:latest')
})

test('capture override changes only the sanitized mock transport', async () => {
  const snapshot = await mkdtemp(join(tmpdir(), 'amcore-setup-capture-'))
  const relative = 'apps/api/src/infrastructure/email/providers/mock.provider.ts'
  const original = await readFile(relative, 'utf8')
  try {
    await mkdir(join(snapshot, 'apps/api/src/infrastructure/email/providers'), { recursive: true })
    await writeFile(join(snapshot, relative), original)
    await prepareOrganizationSetupSource({
      snapshot,
      purpose: 'e2e',
      mocked: false,
      fixtureProfile: 'organization-setup',
      mailCaptureKey: 'a'.repeat(64),
    })
    const transformed = await readFile(join(snapshot, relative), 'utf8')
    assert.ok(transformed.includes('http://mail-capture:8099/deliver'))
    assert.ok(transformed.includes('readonly queuedEmail?'))
    assert.ok(!transformed.includes('Email sent (MOCK)'))
    assert.equal(await readFile(relative, 'utf8'), original)
  } finally {
    await rm(snapshot, { recursive: true, force: true })
  }
})

test('provisioning capture is isolated, preserves queued methods and refuses unsafe allocation', async () => {
  const manifest = {
    purpose: 'e2e',
    mocked: false,
    fixtureProfile: 'organization-provisioning',
    mailCaptureKey: 'a'.repeat(64),
  }
  for (const override of [{ purpose: 'preview' }, { mocked: true }, { mailCaptureKey: '' }])
    assert.throws(() => assertOrganizationSetupFixture({ ...manifest, ...override }))
  assert.deepEqual(standReporters(manifest, '/owned/provisioning'), [
    ['list', { printSteps: false }],
  ])
  const snapshot = await mkdtemp(join(tmpdir(), 'amcore-provisioning-capture-'))
  const relative = 'apps/api/src/infrastructure/email/providers/resend.provider.ts'
  const original = await readFile(relative, 'utf8')
  try {
    await mkdir(join(snapshot, 'apps/api/src/infrastructure/email/providers'), { recursive: true })
    await writeFile(join(snapshot, relative), original)
    await prepareOrganizationSetupSource({ ...manifest, snapshot })
    const transformed = await readFile(join(snapshot, relative), 'utf8')
    assert.ok(transformed.includes("baseUrl: 'http://mail-capture:8099'"))
    assert.ok(!transformed.includes('https://api.resend.com'))
    assert.ok(transformed.includes('http://mail-capture:8099/deliver'))
    assert.ok(transformed.includes('async sendPrepared('))
    assert.ok(transformed.includes('private async sendQueued('))
    assert.ok(transformed.endsWith('\n}\n'))
    assert.equal(await readFile(relative, 'utf8'), original)
    await assert.rejects(
      executeSetupCommand(manifest, { command: 'bootstrap' }),
      /account preparation/
    )
  } finally {
    await rm(snapshot, { recursive: true, force: true })
  }
})

test('internal mailbox accepts only fake recipients, consumes once and bounds content', async (t) => {
  const program = mailCollectorProgram.replace(
    ".listen(8099, '0.0.0.0')",
    ".listen(0, '127.0.0.1', function(){ process.stdout.write(String(this.address().port) + '\\n') })"
  )
  const child = spawn(process.execPath, ['-e', program], {
    env: { PATH: process.env.PATH, AMCORE_SETUP_MAIL_CAPTURE_KEY: 'a'.repeat(64) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(async () => {
    child.kill('SIGTERM')
    await once(child, 'close')
  })
  const [chunk] = await once(child.stdout, 'data')
  const origin = `http://127.0.0.1:${Number(String(chunk).trim())}`
  const send = (path, value, credential = 'a'.repeat(64)) =>
    fetch(origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` },
      body: JSON.stringify(value),
    })
  const message = {
    to: 'recipient@e2e.amcore.test',
    html: '<p>Fixture only</p>',
    text: 'Fixture only',
  }
  assert.equal((await send('/deliver', message, 'wrong')).status, 403)
  assert.equal((await send('/deliver', { ...message, to: 'real@example.com' })).status, 400)
  assert.equal((await send('/deliver', message)).status, 200)
  assert.deepEqual(await (await send('/consume', { to: message.to })).json(), {
    html: message.html,
    text: message.text,
  })
  assert.equal((await send('/consume', { to: message.to })).status, 404)
  await assert.rejects(send('/deliver', { ...message, html: 'x'.repeat(128 * 1024) }))
})
