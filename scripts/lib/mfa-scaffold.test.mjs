import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { createCommittedCopy, runInitProject } from './init-project-test-helpers.mjs'

const retained = [
  'apps/api/prisma/mfa.prisma',
  'apps/api/prisma/migrations/20261025180000_mfa_foundation/migration.sql',
  'apps/api/src/core/auth/auth.module.ts',
  ...[
    'mfa-continuation',
    'mfa-continuation.spec',
    'mfa-encryption.service',
    'mfa-foundation.module',
    'mfa-foundation.service',
    'mfa-foundation.spec',
    'mfa-policy',
    'mfa-proof.repository',
    'mfa-secrets',
    'mfa-totp',
    'mfa-transaction',
  ].map((name) => `apps/api/src/core/auth/mfa/${name}.ts`),
  'apps/api/src/env/schema/auth.env.ts',
  'apps/api/test/mfa-proof.e2e-spec.ts',
  'apps/api/test/mfa-proof.fixture.ts',
  'packages/shared/src/schemas/mfa.ts',
  'packages/shared/src/schemas/mfa-browser.ts',
  'apps/web/src/features/account-mfa/model/account-mfa-controller.ts',
  'apps/web/src/features/account-mfa/ui/enrollment.tsx',
  'apps/web/src/features/account-mfa/ui/backup-codes.tsx',
  'apps/web/src/features/account-mfa/ui/emergency-recovery.tsx',
  'apps/web/src/_app/account-security/server/handlers.ts',
  'apps/web/src/app/api/auth/mfa/route.ts',
  'apps/web/src/app/api/product-admin/auth/mfa/route.ts',
  'docs/auth/mfa-browser.md',
  'docs/auth/mfa-foundation.md',
]

const recipes = [
  ['Console removed', ['--admin-console=disabled']],
  ...['en', 'ru'].map((locale) => [
    `single-${locale}, Console/Storybook/progress disabled`,
    [
      `--mode=single`,
      `--locale=${locale}`,
      '--admin-console=disabled',
      '--storybook=disabled',
      '--route-progress=disabled',
    ],
  ]),
  ['Console host', ['--admin-console=host']],
  [
    'single-ru Console host custom slug',
    ['--mode=single', '--locale=ru', '--admin-console=host', '--admin-console-slug=control'],
  ],
  ['Console custom path', ['--admin-console=path', '--admin-console-slug=control']],
]

for (const [name, flags] of recipes) {
  test(`account MFA foundation survives actual CLI projection: ${name}`, () => {
    const copies = []
    try {
      const root = createCommittedCopy(copies)
      const read = (file) => readFileSync(path.join(root, file), 'utf8')
      const before = new Map(retained.map((file) => [file, read(file)]))
      const result = runInitProject(root, [...flags, '--yes'])
      assert.equal(result.status, 0, result.stderr || result.stdout)
      for (const file of retained) assert.equal(read(file), before.get(file), file)
      assert.match(read('apps/api/prisma/user.prisma'), /mfaAccount\s+MfaAccount\?/)
      assert.match(read('packages/shared/src/schemas/index.ts'), /export \* from '\.\/mfa'/)
      assert.match(read('.env.example'), /MFA_ACTIVE_KEY_ID=current/)
      assert.match(read('.env.example'), /MFA_ENCRYPTION_KEYS=/)
      assert.match(read('apps/api/package.json'), /"otplib": "13\.5\.0"/)
      assert.match(read('pnpm-lock.yaml'), /otplib@13\.5\.0/)
      assert.match(read('docs/auth/README.md'), /\(mfa-foundation\.md\)/)
      assert.match(read('docs/auth/reference.md'), /MFA_ENCRYPTION_KEYS/)
      assert.match(read('CHANGELOG.md'), /Dormant account MFA storage/)
      const single = flags.includes('--mode=single')
      const app = `apps/web/src/app/${single ? '' : '[locale]/'}`
      for (const route of [
        '(auth)/mfa/page.tsx',
        '(dashboard)/account/security/page.tsx',
        '(product-admin)/manage/(auth)/mfa/page.tsx',
        '(product-admin)/manage/(protected)/account/security/page.tsx',
      ]) {
        const source = read(`${app}${route}`)
        if (single) assert.doesNotMatch(source, /resolveLocaleParam|setRequestLocale/)
        else assert.match(source, /resolveLocaleParam/)
      }
      const frame = read('apps/web/src/_pages/account-security/index.tsx')
      if (single) assert.doesNotMatch(frame, /LocaleSwitcher/)
      else assert.match(frame, /LocaleSwitcher/)
      assert.match(read('apps/web/src/app/globals.css'), /--qr-foreground/)
      assert.match(read('apps/web/package.json'), /"qrcode": "1\.5\.4"/)
      if (flags.includes('--admin-console=disabled')) {
        assert.equal(
          existsSync(path.join(root, 'apps/web/src/_app/console-account-security')),
          false
        )
      } else {
        const slug = flags.some((flag) => flag.includes('slug=control')) ? 'control' : 'admin'
        for (const route of ['(auth)/mfa/page.tsx', '(protected)/account/security/page.tsx'])
          assert.match(read(`${app}${slug}/${route}`), /ConsoleAccountSecurityMount/)
      }
      if (flags.includes('--admin-console=disabled')) {
        assert.equal(existsSync(path.join(root, 'docs/operations-console')), false)
      }
    } finally {
      for (const copy of copies) copy.cleanup()
    }
  })
}
