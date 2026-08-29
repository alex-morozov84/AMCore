// init:project --mode=single steps for packages/shared and the apps/api
// Record<SupportedLocale, ...> literals that fail to typecheck once
// SUPPORTED_LOCALES narrows to one entry (ADR-071, PR3B). Trimming
// SUPPORTED_LOCALES is what lets PR3A's localePathPrefix() omit the locale
// prefix in generated backend links — without it, the "no more /en links"
// requirement is unreachable. The "Downstream: running a single-locale app"
// doc's step 5 ("trim SUPPORTED_LOCALES so the backend, emails, and
// notifications agree") names emails explicitly — emailMessages was found
// missing from here via the real `pnpm --filter web build` in
// init-project.test.mjs, alongside telegramGenericMessages.
import { fileStep, linePatchesTransform, trimLocaleRecordLiteral } from './init-engine.mjs'
import { resolveSharedPaths } from './project-config.mjs'

export function buildSharedLocaleSteps(root, locale) {
  const { sharedConstants, telegramMessages, emailMessages } = resolveSharedPaths(root)

  const constantsOps = [
    { regex: /^export const SUPPORTED_LOCALES = \[([^\]]*)\] as const$/m, value: `'${locale}'` },
    { regex: /^export const DEFAULT_LOCALE: SupportedLocale = '([^']*)'$/m, value: locale },
  ]

  const trimRecordStep = (filePath, name) =>
    fileStep(
      filePath,
      (content) => trimLocaleRecordLiteral(content, locale),
      `trim ${name} to the '${locale}' entry (Record<SupportedLocale, ...> would otherwise fail ` +
        'to typecheck against the narrowed union)'
    )

  return [
    fileStep(
      sharedConstants,
      linePatchesTransform(constantsOps),
      `trim SUPPORTED_LOCALES/DEFAULT_LOCALE to '${locale}'`
    ),
    trimRecordStep(telegramMessages, 'telegramGenericMessages'),
    trimRecordStep(emailMessages, 'emailMessages'),
  ]
}
