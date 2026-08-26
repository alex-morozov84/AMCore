// init:project --mode=single steps for packages/shared and the one
// apps/api file that fails to typecheck once SUPPORTED_LOCALES narrows to
// one entry (ADR-071, PR3B). Trimming SUPPORTED_LOCALES is what lets
// PR3A's localePathPrefix() omit the locale prefix in generated backend
// links — without it, the "no more /en links" requirement is unreachable.
import { fileStep, linePatchesTransform, trimLocaleRecordLiteral } from './init-engine.mjs'
import { resolveSharedPaths } from './project-config.mjs'

export function buildSharedLocaleSteps(root, locale) {
  const { sharedConstants, telegramMessages } = resolveSharedPaths(root)

  const constantsOps = [
    { regex: /^export const SUPPORTED_LOCALES = \[([^\]]*)\] as const$/m, value: `'${locale}'` },
    { regex: /^export const DEFAULT_LOCALE: SupportedLocale = '([^']*)'$/m, value: locale },
  ]

  return [
    fileStep(
      sharedConstants,
      linePatchesTransform(constantsOps),
      `trim SUPPORTED_LOCALES/DEFAULT_LOCALE to '${locale}'`
    ),
    fileStep(
      telegramMessages,
      (content) => trimLocaleRecordLiteral(content, locale),
      `trim telegramGenericMessages to the '${locale}' entry (Record<SupportedLocale, ...> would ` +
        'otherwise fail to typecheck against the narrowed union)'
    ),
  ]
}
