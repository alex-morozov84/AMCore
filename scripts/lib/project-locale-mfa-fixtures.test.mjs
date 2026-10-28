import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { createProjectStructuralRegistry } from './project-content-materializer.mjs'
import {
  applyStructuralPlan,
  planStructuralComposition,
} from './path-algebra-structural-compose.mjs'

const paths = {
  'mfa-setup': 'apps/web/e2e/mocked/account-mfa-setup.spec.ts',
  'mfa-story': 'apps/web/src/shared/ui/console-step-up-dialog.stories.tsx',
}
function apply(variant, locale, source = readFileSync(paths[variant], 'utf8')) {
  const registry = createProjectStructuralRegistry()
  const [plan] = planStructuralComposition(registry, [
    {
      kind: 'structural',
      dimension: 'locale',
      path: paths[variant],
      operationKey: 'locale.catalogue-fixture',
      params: { locale, variant },
    },
  ])
  return applyStructuralPlan(registry, plan, source)
}
for (const locale of ['en', 'ru']) {
  test(`MFA ${locale} projection preserves both setup/recovery scenarios with only the selected routes/catalogue`, () => {
    const output = apply('mfa-setup', locale)
    assert.doesNotMatch(output, /\/\$\{locale\}\/mfa/)
    assert.doesNotMatch(output, /locale === 'en'/)
    assert.equal((output.match(/page\.goto\('\/mfa'\)/g) ?? []).length, 2)
    assert.match(output, new RegExp(`locale: '${locale}'`))
    assert.doesNotMatch(output, new RegExp(`locale: '${locale === 'en' ? 'ru' : 'en'}'`))
    assert.match(output, /server recovery shows the recovery error/)
    assert.match(output, /unknown/)
    assert.doesNotMatch(output, new RegExp(`/messages/${locale === 'en' ? 'ru' : 'en'}\\.json`))
    const story = apply('mfa-story', locale)
    assert.match(story, new RegExp(`locale="${locale}"`))
    assert.doesNotMatch(story, new RegExp(`/messages/${locale === 'en' ? 'ru' : 'en'}\\.json`))
  })
}
test('MFA projection fails closed if its known route shape drifts', () => {
  const source = readFileSync(paths['mfa-setup'], 'utf8').replace(
    '`/${locale}/mfa`',
    "'/unexpected'"
  )
  assert.throws(() => apply('mfa-setup', 'ru', source), /route fixture count drifted/)
})
