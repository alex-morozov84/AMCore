// init:project --mode=single: error-messages.test.ts, the one i18n-coverage
// fixture with no literal translated text (just key-existence checks genuinely
// parametrized over SUPPORTED_LOCALES already) — found via the real `pnpm
// --filter web build` in init-project.test.mjs, alongside three sibling
// fixtures that DO assert literal translated text and need a locale-branched
// rewrite instead (project-plan-web-oauth-alert-test.mjs,
// project-plan-web-zod-error-map-test.mjs,
// project-plan-web-api-error-alert-test.mjs).
import path from 'node:path'
import { fileStep, replaceExactBlock } from './init-engine.mjs'

const OTHER_LOCALE = { en: 'ru', ru: 'en' }

const IMPORTS_BEFORE = `import en from '../../../messages/en.json'
import ru from '../../../messages/ru.json'
`

const CATALOGUES_BEFORE = `const catalogues: Record<string, { errors: Record<string, string> }> = { en, ru }
`

function errorMessagesTransform(locale) {
  const kept = locale
  return (content) => {
    const next = replaceExactBlock(
      content,
      IMPORTS_BEFORE,
      `import ${kept} from '../../../messages/${kept}.json'\n`
    )
    return replaceExactBlock(
      next,
      CATALOGUES_BEFORE,
      `const catalogues: Record<string, { errors: Record<string, string> }> = { ${kept} }\n`
    )
  }
}

export function buildWebI18nFixturesSteps(root, locale) {
  return [
    fileStep(
      path.join(root, 'apps/web/src/shared/api/error-messages.test.ts'),
      errorMessagesTransform(locale),
      `error-messages.test.ts: test only the ${locale} catalogue (drop the ${OTHER_LOCALE[locale]} import)`
    ),
  ]
}
