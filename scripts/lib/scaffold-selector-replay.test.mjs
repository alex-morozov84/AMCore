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
  ['#431', ['scripts/lib/project-composition-contract.test.mjs'], true],
  ['#430', ['scripts/lib/brand-facts.mjs', 'docs/frontend/brand-theme-and-tokens.md'], true],
  ['locale migration', ['.github/workflows/ci.yml', 'scripts/lib/locale-ownership.mjs'], true],
  ['PostgreSQL 18', ['apps/api/test/example.spec.ts', 'docker-compose.yml'], true],
  ['CSP fix', ['apps/web/src/app/layout.tsx'], true],
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
