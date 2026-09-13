// Test fixtures import the retained catalogue after single-locale pruning.
import path from 'node:path'
import { fileStep, replaceAllExactText } from './init-engine.mjs'

const FIXTURES = [
  {
    file: 'apps/web/src/_pages/settings/SessionsPage/SessionsTable.test.tsx',
    depth: '../../../../',
    text: { en: ['Actions', 'This device'], ru: ['Действия', 'Это устройство'] },
  },
  {
    file: 'apps/web/src/features/auth-oauth/ui/OAuthSection.test.tsx',
    depth: '../../../../',
    text: { en: ['Continue with Google'], ru: ['Продолжить с Google'] },
  },
  {
    file: 'apps/web/src/shared/ui/section-error-boundary.test.tsx',
    depth: '../../../',
    text: { en: [], ru: [] },
  },
]

function transform({ depth, text }, locale) {
  return (content) => {
    let next = replaceAllExactText(
      content,
      `import en from '${depth}messages/en.json'`,
      `import ${locale} from '${depth}messages/${locale}.json'`
    )
    next = replaceAllExactText(
      next,
      'locale="en" messages={en}',
      `locale="${locale}" messages={${locale}}`
    )
    for (const [index, after] of text[locale].entries()) {
      const before = text.en[index]
      if (before !== after) next = replaceAllExactText(next, before, after)
    }
    return next
  }
}

export function buildWebSingleLocaleTestCatalogueSteps(root, locale) {
  return FIXTURES.map(({ file, ...fixture }) =>
    fileStep(
      path.join(root, file),
      transform(fixture, locale),
      `${path.basename(file)}: use the kept ${locale} catalogue`
    )
  )
}
