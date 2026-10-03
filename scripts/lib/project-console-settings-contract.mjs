import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const foundation = 'apps/api/src/infrastructure/settings'
const retained = [
  'apps/api/prisma/settings.prisma',
  'apps/api/prisma/migrations/20261002120000_platform_settings/migration.sql',
  'apps/api/src/core/admin/admin-storage-setting.controller.ts',
  'apps/api/src/core/admin/admin-storage-setting.service.ts',
  'apps/api/src/core/admin/platform-settings-principal.guard.ts',
  'packages/shared/src/schemas/storage-probe-setting.ts',
  'packages/shared/src/types/storage-probe-setting.ts',
  'apps/web/src/shared/ui/inline-setting-field.tsx',
  'apps/web/src/shared/ui/inline-setting-field.test.tsx',
  'docs/backend/settings.md',
]
const removed = [
  'apps/web/src/features/console-storage-setting',
  'apps/web/src/app/api/console/runtime-settings',
  'apps/web/e2e/real-stack/storage-runtime-settings.spec.ts',
  'apps/web/e2e/shared/storage-setting-journey.ts',
  'apps/web/e2e/support/runtime-settings-proof.ts',
  'scripts/stand/runtime-settings-proof.mjs',
]
const read = (root, name) => readFileSync(path.join(root, name), 'utf8')

export function checkRetainedSettings(source, output) {
  for (const name of [
    ...retained,
    ...readdirSync(path.join(source, foundation)).map((name) => `${foundation}/${name}`),
  ])
    assert.equal(read(output, name), read(source, name), name)
  assert.match(read(output, 'docs/frontend/shared-ui-and-shadcn.md'), /InlineSettingField/)
  assert.match(read(output, 'apps/api/src/app-imports.ts'), /SettingsModule/)
  assert.match(
    read(output, 'apps/api/src/core/admin/admin.module.ts'),
    /AdminStorageSettingController/
  )
  assert.match(read(output, 'packages/shared/src/schemas/index.ts'), /storage-probe-setting/)
  assert.match(
    read(output, 'apps/api/src/infrastructure/storage/storage-probe.service.ts'),
    /SettingsReader/
  )
}

export function checkRemovedSettings(output) {
  for (const name of removed) assert.equal(existsSync(path.join(output, name)), false, name)
  for (const name of ['docs/storage/configuration.md', 'docs/operations/deployment.md']) {
    const text = read(output, name)
    assert.doesNotMatch(
      text,
      /AMCORE_CONSOLE_STORAGE_SETTING|inline interval.*Console|On Console Overview/
    )
    assert.match(text, /operator API/)
    assert.match(text, /baseline/)
  }
}

export function checkSettingsLocale(output, locale) {
  const text = read(
    output,
    `${'apps/web/src/features/console-storage-setting'}/ui/StorageProbeIntervalEditor.test.tsx`
  )
  assert.match(text, new RegExp(`/messages/${locale}\\.json`))
  assert.match(text, new RegExp(`locale="${locale}" messages=\\{${locale}\\}`))
  const journey = read(output, 'apps/web/e2e/shared/storage-setting-journey.ts')
  assert.match(journey, new RegExp(locale === 'ru' ? 'Файловое хранилище' : 'File storage'))
  if (locale === 'ru') {
    assert.doesNotMatch(text, /\ben\.console|name: 'Save'|name: 'Cancel'/)
    assert.match(text, /name: 'Повторить'/)
    assert.doesNotMatch(journey, /name: 'Save'|name: 'Cancel'/)
  }
}
