import assert from 'node:assert/strict'
import { test } from 'node:test'

import { classifyChanges } from '../scaffold-selector/classify.mjs'
import { readDeclaration } from '../scaffold-selector/declaration.mjs'

const declaration = readDeclaration('scripts/scaffold-selector/declaration.v1.json')
const baseFiles = declaration.memberships.flatMap((item) => fixtureFor(item.glob))
const readText = () => ({ kind: 'text', text: 'ordinary prose' })

function fixtureFor(glob) {
  return {
    'apps/web/src/**/*.stories.tsx': ['apps/web/src/a.stories.tsx'],
    'apps/web/src/app/**/page.tsx': ['apps/web/src/app/page.tsx'],
    'apps/api/src/**/*.spec.ts': ['apps/api/src/a.spec.ts'],
    'apps/web/src/**/*.test.ts': ['apps/web/src/a.test.ts'],
    'apps/web/messages/*.json': ['apps/web/messages/en.json'],
    'packages/*/package.json': ['packages/shared/package.json'],
    'apps/web/src/features/console-login/**': ['apps/web/src/features/console-login/index.ts'],
  }[glob]
}

const samples = [
  ['support mail changelog seam', ['CHANGELOG.md'], true],
  ['support mail ownership', ['scripts/lib/operations-console-stand-seams.mjs'], true],
  ['support mail profiles', ['scripts/stand/organization-setup-fixture.mjs'], true],
  ['support mail browser config', ['apps/web/playwright.product-admin-real-stack.config.ts'], true],
  [
    'support mail browser inventory',
    ['apps/web/e2e/product-admin-real-stack/console-support-mail.spec.ts'],
    true,
  ],
  [
    'support mail retained backend',
    ['apps/api/src/core/admin/support-mail/support-mail.service.ts'],
    true,
  ],
  ['locale lint fixtures', ['scripts/fixtures/lint/web.json'], true],
  ['paired lint wrapper', ['scripts/lint.mjs'], true],
  ['#431', ['scripts/lib/project-composition-contract.test.mjs'], true],
  ['#430', ['scripts/lib/brand-facts.mjs', 'docs/frontend/brand-theme-and-tokens.md'], true],
  ['locale migration', ['.github/workflows/ci.yml', 'scripts/lib/locale-ownership.mjs'], true],
  ['Storybook migration', ['scripts/lib/storybook-ownership.mjs'], true],
  ['route-progress migration', ['scripts/lib/project-route-progress-ownership.mjs'], true],
  ['covering array', ['scripts/lib/scaffold-covering-recipes.mjs'], true],
  ['managed stand runtime', ['scripts/stand/cancellation.mjs'], true],
  ['managed stand entry', ['scripts/stand.mjs'], true],
  ['managed stand guide', ['docs/operations/local-stands.md'], true],
  ['PostgreSQL 18', ['apps/api/test/example.spec.ts', 'docker-compose.yml'], true],
  ['CSP fix', ['apps/web/src/app/layout.tsx'], true],
  ['Console docs closeout', ['docs/operations-console/development.md'], true],
  ['dependency workflow docs', ['.github/workflows/dependency-review.yml'], true],
  ['CQRS guidance', ['docs/backend/architecture-and-conventions.md'], false],
  ['new backup runbook', ['docs/operations/new-backup.md'], true, 'A'],
]

test('replays real historical path classes with conservative current rules', () => {
  for (const [name, paths, expected, status = 'M'] of samples) {
    const result = classifyChanges({
      declaration,
      changes: paths.map((pathname) => ({ status, path: pathname })),
      baseFiles,
      headFiles: baseFiles,
      readText,
    })
    assert.equal(result.required, expected, name)
  }
})
