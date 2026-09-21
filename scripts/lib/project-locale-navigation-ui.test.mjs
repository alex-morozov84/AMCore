import assert from 'node:assert/strict'
import { test } from 'node:test'

import { materializeProjectContentPath } from './project-content-materializer.mjs'
import { buildLocaleNavigationFacts } from './project-locale-navigation-facts.mjs'

const paths = [
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
      /import \{ usePathname \} from 'next\/navigation'\nimport \{ useTranslations \} from 'next-intl'\n\nimport /
    )
    assert.doesNotMatch(projected, /@\/i18n\/navigation/)
  }
})
