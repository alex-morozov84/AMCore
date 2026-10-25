import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { standReporters } from '../../apps/web/e2e/support/managed-target.mjs'
import { productAdminE2ePlans } from '../product-admin-e2e-plan.mjs'
import {
  assertOrganizationSetupFixture,
  prepareOrganizationSetupSource,
} from './organization-setup-fixture.mjs'
import { executeSetupCommand } from './setup-command.mjs'
import { productAdminProfiles } from './product-admin-source.mjs'
import { create } from './create.mjs'
import { configuration } from './config.mjs'
import { directory } from './state.mjs'

for (const profile of ['support-mail-path', 'support-mail-host']) {
  test(`${profile} uses internal mail only and preserves the final transport fence`, async () => {
    const snapshot = await mkdtemp(join(tmpdir(), 'amcore-support-mail-'))
    const relative = 'apps/api/src/infrastructure/email/providers/resend.provider.ts'
    const original = await readFile(relative, 'utf8')
    const m = {
      snapshot,
      purpose: 'e2e',
      mocked: false,
      fixtureProfile: profile,
      mailCaptureKey: 'a'.repeat(64),
    }
    try {
      await mkdir(join(snapshot, 'apps/api/src/infrastructure/email/providers'), {
        recursive: true,
      })
      await writeFile(join(snapshot, relative), original)
      await prepareOrganizationSetupSource(m)
      const source = await readFile(join(snapshot, relative), 'utf8')
      const urls = source.match(/https?:\/\/[^\s'"`)]+/gu) ?? []
      assert.ok(urls.length > 0)
      assert.ok(urls.every((url) => new URL(url).origin === 'http://mail-capture:8099'))
      assert.ok(source.includes('async sendPrepared('))
      assert.ok(source.includes('private async sendQueued('))
      const start = source.indexOf(
        '  async send(params: SendEmailParams): Promise<SendEmailResult> {'
      )
      const end = source.indexOf('\n  }', start)
      const implementation = source
        .slice(start, end + 4)
        .replace(
          'async send(params: SendEmailParams): Promise<SendEmailResult>',
          'async function(params)'
        )
      let fence = 0,
        calls = 0
      const fetch = async (url, options) => {
        assert.equal(fence, 1)
        assert.equal(url, 'http://mail-capture:8099/deliver')
        assert.deepEqual(JSON.parse(options.body), {
          to: 'recipient@e2e.amcore.test',
          html: '<p>fake mail</p>',
          text: '',
        })
        calls++
        return { ok: true }
      }
      const send = new Function('fetch', 'process', 'AbortSignal', `return (${implementation})`)(
        fetch,
        { env: { AMCORE_SETUP_MAIL_CAPTURE_KEY: m.mailCaptureKey } },
        globalThis.AbortSignal
      )
      const params = {
        to: 'recipient@e2e.amcore.test',
        html: '<p>fake mail</p>',
        beforeTransport: () => {
          fence++
        },
      }
      assert.equal((await send(params)).success, true)
      assert.equal(fence, 1)
      assert.equal(calls, 1)
      await send({
        ...params,
        beforeTransport: () => {
          throw new Error('expired')
        },
      })
      assert.equal(calls, 1)
      await send({ ...params, to: 'real@example.com' })
      assert.equal(fence, 1)
      assert.equal(calls, 1)
      assert.equal(await readFile(relative, 'utf8'), original)
    } finally {
      await rm(snapshot, { recursive: true, force: true })
    }
  })

  test(`${profile} has a required CI inventory, secret-free reporters and narrow setup authority`, async () => {
    assert.ok(productAdminProfiles.includes(profile))
    assert.deepEqual(productAdminE2ePlans[profile], {
      lane: 'product-admin-real-stack',
      fixture: profile,
      files: ['console-support-mail.spec.ts'],
    })
    const valid = {
      purpose: 'e2e',
      mocked: false,
      fixtureProfile: profile,
      mailCaptureKey: 'a'.repeat(64),
    }
    assert.doesNotThrow(() => assertOrganizationSetupFixture(valid))
    for (const override of [{ purpose: 'preview' }, { mocked: true }, { mailCaptureKey: '' }])
      assert.throws(() => assertOrganizationSetupFixture({ ...valid, ...override }))
    assert.deepEqual(standReporters(valid, '/owned/support-mail'), [
      ['list', { printSteps: false }],
    ])
    await assert.rejects(
      executeSetupCommand(valid, { command: 'bootstrap' }),
      /account preparation/
    )
    const config = await readFile('apps/web/playwright.product-admin-real-stack.config.ts', 'utf8')
    assert.match(config, /trace: 'off'/)
    assert.match(config, /screenshot: 'off'/)
    assert.match(config, /video: 'off'/)
    assert.match(config, /config.retries = 0/)
  })
}

test('ordinary host rehearsal projects the Console login independently of the checkout default', async () => {
  const id = `host-config-${randomUUID()}`
  try {
    const m = await create(id, 'e2e', 'host', false, 'organization-setup')
    const source = await readFile(
      join(m.snapshot, 'apps/web/src/shared/lib/admin-console.generated.ts'),
      'utf8'
    )
    assert.match(source, /mode: 'host'/)
    await configuration(m)
    assert.equal(m.model.services.web.environment.ADMIN_CONSOLE_ORIGIN, m.origins.console)
  } finally {
    await rm(directory(id), { recursive: true, force: true })
  }
})
