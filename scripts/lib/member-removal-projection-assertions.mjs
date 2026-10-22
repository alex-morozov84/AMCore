import assert from 'node:assert/strict'

/** Removal is product functionality; optional frontend dimensions must retain it. */
export function assertMemberRemovalProjection({ read, exists, flags }) {
  for (const file of [
    'apps/api/src/core/organizations/member.service.ts',
    'packages/shared/src/schemas/organization-members.ts',
    'packages/shared/src/types/organization-members.ts',
    'apps/web/src/entities/organization-context/api/member-removal-client.ts',
    'apps/web/src/entities/organization-context/api/member-removal.server.ts',
    'apps/web/src/features/member-removal/ui/removal-notice.tsx',
    'apps/web/src/features/member-removal/ui/member-removal.test.tsx',
    'apps/web/src/shared/ui/confirm-dialog.tsx',
    'apps/web/src/shared/ui/section-navigation.tsx',
  ])
    assert.ok(exists(file), file)

  assert.equal(
    exists('apps/web/src/shared/ui/confirm-dialog.stories.tsx'),
    flags.storybook !== 'disabled'
  )
  for (const locale of flags.mode === 'single' ? [flags.locale] : ['en', 'ru']) {
    const messages = JSON.parse(read(`apps/web/messages/${locale}.json`))
    for (const key of ['selfSuccessTitle', 'unknownTitle', 'lastAdminTitle', 'check'])
      assert.ok(messages.memberRemoval[key], `${locale}: memberRemoval.${key}`)
    assert.ok(messages.errors.RESOURCE_NOT_FOUND, `${locale}: RESOURCE_NOT_FOUND`)
  }

  // These consumers use supported locale APIs rather than a catalogue removed by init.
  const browser = read('apps/web/e2e/real-stack/organization-member-removal.spec.ts')
  assert.match(browser, /for \(const locale of SUPPORTED_LOCALES\)/)
  assert.match(browser, /localizedFrontendUrl/)
  const headless = read('scripts/fixtures/organization-members-headless.spec.ts.fixture')
  assert.match(headless, /messages\/\$\{DEFAULT_LOCALE\}\.json/)
  assert.match(headless, /localizedFrontendUrl/)
  const client = read('scripts/fixtures/organization-members-headless-client.tsx.fixture')
  assert.match(client, /import \{ InlineRemoval \} from '\.\/member-removal'/)
  assert.match(client, /<InlineRemoval\b/)
  assert.doesNotMatch(client, /@\/features\/member-removal/)
  const removal = read('scripts/fixtures/organization-members-removal.tsx.fixture')
  assert.match(removal, /useMemberRemoval/)
  assert.match(removal, /from '@\/entities\/organization-context'/)
  assert.doesNotMatch(removal, /@\/features\/member-removal/)
  const messages = read('apps/web/src/features/member-removal/ui/member-removal-test-messages.ts')
  assert.doesNotMatch(messages, /messages\/en\.json/)
}
