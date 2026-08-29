// init:project --mode=single: locale-negotiation.spec.ts. Found via the real
// `pnpm --filter api test` in init-project.test.mjs — this one is a runtime
// test failure, not a typecheck error: `supportedLocaleSchema.safeParse('ru')`
// asserts `.success === true`, which flips to `false` once SUPPORTED_LOCALES
// trims to one entry. The two `makeReq(..., 'ru')` calls are untouched: that
// parameter is typed `string | false` (the raw, not-yet-validated
// Accept-Language negotiation result) and is never read in either test (the
// header is absent/blank, so negotiation never runs) — changing it would
// imply a significance it doesn't have.
import path from 'node:path'
import { fileStep, replaceExactBlock } from './init-engine.mjs'

const BEFORE = `    expect(supportedLocaleSchema.safeParse('ru').success).toBe(true)
    expect(supportedLocaleSchema.safeParse('en').success).toBe(true)
    expect(supportedLocaleSchema.safeParse('de').success).toBe(false)
    expect(supportedLocaleSchema.safeParse('EN').success).toBe(false)
`

function after(locale) {
  const other = locale === 'en' ? 'ru' : 'en'
  return `    expect(supportedLocaleSchema.safeParse('${locale}').success).toBe(true)
    expect(supportedLocaleSchema.safeParse('${other}').success).toBe(false)
    expect(supportedLocaleSchema.safeParse('de').success).toBe(false)
    expect(supportedLocaleSchema.safeParse('${locale.toUpperCase()}').success).toBe(false)
`
}

export function buildApiLocaleNegotiationTestSteps(root, locale) {
  return [
    fileStep(
      path.join(root, 'apps/api/src/core/auth/locale-negotiation.spec.ts'),
      (content) => replaceExactBlock(content, BEFORE, after(locale)),
      `locale-negotiation.spec.ts: supportedLocaleSchema now accepts only '${locale}'`
    ),
  ]
}
