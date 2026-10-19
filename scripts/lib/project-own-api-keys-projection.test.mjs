import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { createCommittedCopy, runInitProject } from './init-project-test-helpers.mjs'

const scenarios = [
  ['single-en', ['--mode=single', '--locale=en']],
  ['single-ru', ['--mode=single', '--locale=ru']],
  ['console-disabled', ['--admin-console=disabled']],
  ['storybook-disabled', ['--storybook=disabled']],
  [
    'host-route-off',
    ['--admin-console=host', '--admin-console-slug=panel', '--route-progress=disabled'],
  ],
  [
    'combined-ru',
    [
      '--mode=single',
      '--locale=ru',
      '--admin-console=disabled',
      '--storybook=disabled',
      '--route-progress=disabled',
    ],
  ],
]

function assertOwnKeySurface(root, flags) {
  const read = (file) => readFileSync(path.join(root, file), 'utf8')
  const exists = (file) => existsSync(path.join(root, file))
  const single = flags.includes('--mode=single')
  const stories = !flags.includes('--storybook=disabled')
  const prefix = single ? '' : '[locale]/'
  assert.ok(exists(`apps/web/src/app/${prefix}(dashboard)/settings/api-keys/page.tsx`))
  if (single) assert.equal(exists('apps/web/src/app/[locale]'), false)
  for (const route of ['route.ts', '[id]/route.ts', 'session/route.ts', 'organizations/route.ts'])
    assert.ok(exists(`apps/web/src/app/api/own-api-keys/${route}`), route)
  for (const symbol of [
    'useOwnApiKeyController',
    'useOwnApiKeySecret',
    'useOwnKeyRevocation',
    'useOwnKeyOrganizations',
  ])
    assert.ok(read('apps/web/src/entities/api-key/index.ts').includes(symbol), symbol)
  assert.match(read('apps/web/src/entities/api-key/index.server.ts'), /readOwnApiKeyAdmission/)
  for (const file of ['model/own-key-revocation.ts', 'ui/organization-picker.tsx'])
    assert.ok(exists(`apps/web/src/entities/api-key/${file}`), file)
  for (const module of ['copy-button', 'timestamp', 'combobox']) {
    assert.ok(exists(`apps/web/src/shared/ui/${module}.tsx`), module)
    assert.doesNotMatch(
      read(`apps/web/src/shared/ui/${module}.tsx`),
      /console-detail|console-time-zone/
    )
  }
  const navigation = read('apps/web/src/_app/organization-access/ui/navigation-entry.tsx')
  assert.match(navigation, /ownApiKeysPath/)
  if (single) {
    assert.match(navigation, /from 'next\/navigation'/)
    assert.doesNotMatch(navigation, /@\/i18n\/navigation/)
    const host = read('apps/web/src/widgets/own-api-keys/ui/own-api-keys-host.tsx')
    assert.doesNotMatch(host, /@\/i18n\/navigation/)
    assert.match(host, /import \{ usePathname, useSearchParams \} from 'next\/navigation'/)
  }
  for (const story of [
    'shared/ui/combobox.stories.tsx',
    'shared/ui/timestamp.stories.tsx',
    'features/own-api-key-create/ui/own-api-key-create.stories.tsx',
  ])
    assert.equal(exists(`apps/web/src/${story}`), stories, story)
  if (!stories) assert.doesNotMatch(read('apps/web/vitest.config.ts'), /@storybook|storybookTest/)
  const locales = single ? [flags.includes('--locale=ru') ? 'ru' : 'en'] : ['en', 'ru']
  for (const locale of locales) {
    const messages = JSON.parse(read(`apps/web/messages/${locale}.json`))
    for (const key of ['create', 'revokeIdDescription', 'revokeRefused', 'creationCheckFailed'])
      assert.ok(messages.ownApiKeys[key], `${locale}: ${key}`)
  }
  if (flags.includes('--admin-console=disabled')) {
    assert.equal(exists('apps/web/src/shared/ui/console-detail'), false)
    assert.equal(exists('apps/web/src/_pages/console'), false)
    assert.ok(exists('apps/web/src/widgets/own-api-keys/ui/own-api-keys.tsx'))
    assert.ok(exists('apps/api/src/core/api-keys/own-key-organizations.service.ts'))
  }
  if (flags.includes('--route-progress=disabled'))
    assert.match(read('apps/web/src/shared/lib/route-progress/route-progress-flag.ts'), /false/)
  for (const doc of ['docs/product-admin/own-api-keys.md', 'docs/auth/api-keys.md']) {
    for (const match of read(doc).matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1].split('#')[0]
      if (!target || target.includes('://') || target.startsWith('/')) continue
      assert.ok(exists(path.join(path.dirname(doc), target)), `${doc} -> ${target}`)
    }
  }
}

for (const [name, flags] of scenarios) {
  test(`own-key ready/headless surface survives actual CLI ${name}`, () => {
    const copies = []
    try {
      const root = createCommittedCopy(copies)
      const result = runInitProject(root, [...flags, '--yes'])
      assert.equal(result.status, 0, result.stderr || result.stdout)
      assertOwnKeySurface(root, flags)
    } finally {
      for (const copy of copies) copy.cleanup()
    }
  })
}
