import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { materializeProjectContentPath } from './project-content-materializer.mjs'
import { buildLocaleNavigationFacts } from './project-locale-navigation-facts.mjs'
import { createWorkingTreeCopy } from './working-tree-fixture.mjs'

const paths = [
  'apps/web/src/_app/organization-access/ui/navigation-entry.tsx',
  'apps/web/src/widgets/console-shell/ui/ConsoleBreadcrumb.tsx',
  'apps/web/src/widgets/console-shell/ui/ConsoleNavigation.tsx',
]

test('plain pathname projection keeps external imports in one sorted group', () => {
  const facts = buildLocaleNavigationFacts('en')
  for (const pathname of paths) {
    const projected = materializeProjectContentPath(
      process.cwd(),
      pathname,
      facts.filter((fact) => fact.path === pathname)
    ).after
    assert.match(
      projected,
      /import \{ usePathname \} from 'next\/navigation'\nimport \{ useTranslations \} from 'next-intl'\n(?:import [^\n]+ from '[^@][^']*'\n)*\nimport /
    )
    assert.doesNotMatch(projected, /@\/i18n\/navigation/)
  }
})

test('plain pathname projection supports detail links without next-intl', () => {
  const facts = buildLocaleNavigationFacts('en')
  for (const pathname of [
    'apps/web/src/shared/ui/console-detail/ConsoleContextLink.tsx',
    'apps/web/src/shared/ui/console-detail/ConsoleRestorePosition.tsx',
  ]) {
    const projected = materializeProjectContentPath(
      process.cwd(),
      pathname,
      facts.filter((fact) => fact.path === pathname)
    ).after
    const expected = pathname.endsWith('ConsoleRestorePosition.tsx')
      ? /import \{ usePathname, useSearchParams \} from 'next\/navigation'/
      : /import \{ usePathname \} from 'next\/navigation'/
    assert.match(projected, expected)
    assert.equal(projected.match(/from 'next\/navigation'/g)?.length, 1)
    assert.doesNotMatch(projected, /@\/i18n\/navigation/)
  }
})

const ownHost = 'apps/web/src/widgets/own-api-keys/ui/own-api-keys-host.tsx'
test('pathname projection merges the existing search-params import for EN and RU', () => {
  for (const locale of ['en', 'ru']) {
    const facts = buildLocaleNavigationFacts(locale).filter((fact) => fact.path === ownHost)
    assert.equal(facts.length, 1)
    const projected = materializeProjectContentPath(process.cwd(), ownHost, facts).after
    assert.match(projected, /import \{ usePathname, useSearchParams \} from 'next\/navigation'/)
    assert.equal(projected.match(/from 'next\/navigation'/g)?.length, 1)
    assert.doesNotMatch(projected, /@\/i18n\/navigation/)
    assert.match(projected, /router.replace\(href, \{ scroll: false \}\)/)
  }
})
test('pathname merge rejects an unsupported namespace import before materialization', () => {
  const copy = createWorkingTreeCopy()
  try {
    const file = path.join(copy.root, ownHost)
    const before = readFileSync(file, 'utf8').replace(
      "import { useSearchParams } from 'next/navigation'",
      "import * as next from 'next/navigation'"
    )
    writeFileSync(file, before)
    const facts = buildLocaleNavigationFacts('ru').filter((fact) => fact.path === ownHost)
    assert.throws(
      () => materializeProjectContentPath(copy.root, ownHost, facts),
      /pathname projection requires named value imports/
    )
    assert.equal(readFileSync(file, 'utf8'), before)
  } finally {
    copy.cleanup()
  }
})
