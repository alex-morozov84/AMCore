import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const retainedRoots = ['apps/api/src', 'apps/api/prisma', 'packages/shared/src']
const consolePaths = [
  'apps/web/src/features/console-user-support-mail',
  'apps/web/src/app/api/console/users/[id]/support-mail',
  'apps/web/e2e/product-admin-real-stack/console-support-mail.spec.ts',
  'apps/web/e2e/support/secret-mail.ts',
  'scripts/stand/support-mail-fixture.mjs',
  'scripts/stand/support-mail-fixture.test.mjs',
  'scripts/stand/support-mail-preview.mjs',
]
const profileConsumers = [
  'scripts/stand/product-admin-source.mjs',
  'scripts/product-admin-e2e-plan.mjs',
  'scripts/lib/product-admin-e2e-inventory.test.mjs',
  'scripts/stand/organization-setup-fixture.mjs',
  'scripts/stand/config.mjs',
  'scripts/stand/config-proof.test.mjs',
  'scripts/stand/create.mjs',
  'scripts/stand/start.mjs',
  'scripts/stand/setup-command.mjs',
  'scripts/stand/setup-mail-consume.mjs',
  'apps/web/e2e/support/managed-target.mjs',
  'apps/web/playwright.product-admin-real-stack.config.ts',
]
const read = (root, relative) => readFileSync(join(root, relative), 'utf8')

// Snapshot the disposable source fixture before projection, excluding local generated clients.
export function supportMailCoreSnapshot(root) {
  const snapshot = new Map()
  for (const directory of retainedRoots) {
    for (const file of readdirSync(join(root, directory), { recursive: true })) {
      if (!/\.(ts|prisma|sql)$/.test(file)) continue
      const relative = `${directory}/${file}`
      snapshot.set(relative, read(root, relative))
    }
  }
  snapshot.set('docs/auth/email-auth.md', read(root, 'docs/auth/email-auth.md'))
  return snapshot
}

export function assertSupportMailCoreRetained(root, snapshot) {
  for (const [relative, source] of snapshot) assert.equal(read(root, relative), source, relative)
  for (const name of ['auth', 'errors'])
    assert.ok(JSON.parse(read(root, 'apps/web/messages/en.json'))[name])
}

export function assertSupportMailProjection(root, enabled, locale) {
  for (const relative of consolePaths)
    assert.equal(existsSync(join(root, relative)), enabled, relative)
  const messages = JSON.parse(read(root, `apps/web/messages/${locale ?? 'en'}.json`))
  assert.equal(Boolean(messages.console?.supportMail), enabled)
  if (enabled) {
    for (const profile of ['support-mail-path', 'support-mail-host']) {
      assert.ok(read(root, 'scripts/product-admin-e2e-plan.mjs').includes(profile))
      assert.ok(read(root, 'scripts/stand/product-admin-source.mjs').includes(profile))
    }
    if (locale) {
      for (const relative of [
        'model/use-support-mail.test.tsx',
        'ui/SupportMailDialog.test.tsx',
        'ui/UserSupportMailCard.test.tsx',
        'ui/UserSupportMailCard.stories.tsx',
      ]) {
        const source = read(root, `apps/web/src/features/console-user-support-mail/${relative}`)
        assert.ok(source.includes(`messages/${locale}.json`))
        assert.ok(!source.includes(`messages/${locale === 'en' ? 'ru' : 'en'}.json`))
      }
    }
    return
  }
  for (const relative of profileConsumers)
    assert.doesNotMatch(read(root, relative), /support-mail|SUPPORT_MAIL/, relative)
  for (const relative of [
    'docs/operations/local-stands.md',
    'docs/frontend/testing.md',
    'CHANGELOG.md',
  ])
    assert.doesNotMatch(
      read(root, relative),
      /AMCORE_CONSOLE_SUPPORT_MAIL|support-mail-path|support-mail-host/,
      relative
    )
  assert.doesNotMatch(read(root, 'docs/README.md'), /help-someone-sign-in/)
  assert.match(
    read(root, 'scripts/stand/organization-setup-fixture.mjs'),
    /organization-provisioning/
  )
}
