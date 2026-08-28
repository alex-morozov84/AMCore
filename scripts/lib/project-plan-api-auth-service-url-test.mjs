// init:project --mode=single: three auth.service.spec.ts assertions asserting
// a '/ru/...' locale-prefixed link. Found via the real `pnpm --filter api
// test` in init-project.test.mjs — missed by the initial grep sweep because
// it searched for the literal `'ru'` token, which does not match 'ru' as a
// URL path segment (e.g. `'/ru/verify-email'`). Single-locale mode means
// `localizedFrontendUrl` never prefixes a path at all (see
// localePathPrefix's doc comment) — every assertion here drops to "no
// locale segment," not "the kept locale's segment."
//
// Exports a transform, not a fileStep: project-plan-api-locale-fixtures.mjs
// already owns a fileStep for this same path (mockUser/register/
// updateProfile fixtures). Two independent fileSteps against the same file
// would each read the pre-transform content and the second write() would
// silently discard the first's changes — every step targeting one file
// must compose into a single fileStep.
import { replaceExactBlock } from './init-engine.mjs'

const VERIFICATION_URL_BEFORE = `        // Locale-prefixed: a bare path would be resolved by cookie/Accept-Language,
        // which an emailed link cannot rely on.
        expect(payload.verificationUrl).toContain('/ru/verify-email')
`

const VERIFICATION_URL_AFTER = `        // Single-locale mode: no locale segment at all — see localePathPrefix's
        // doc comment.
        expect(payload.verificationUrl).toContain('/verify-email')
        expect(payload.verificationUrl).not.toMatch(/\\/[a-z]{2}\\/verify-email/)
`

const RESET_URL_BEFORE = `          // Full prefixed path — asserting only 'reset-password?token=' would
          // still pass if the locale prefix regressed away.
          resetUrl: expect.stringContaining('/ru/reset-password?token='),
`

const RESET_URL_AFTER = `          // Single-locale mode: no locale segment — asserting the bare path
          // still catches a stray prefix regressing back in.
          resetUrl: expect.stringMatching(/^https:\\/\\/[^/]+\\/reset-password\\?token=/),
`

const VERIFY_URL_BEFORE = `          verificationUrl: expect.stringContaining('/ru/verify-email?token='),
`

const VERIFY_URL_AFTER = `          verificationUrl: expect.stringMatching(/^https:\\/\\/[^/]+\\/verify-email\\?token=/),
`

export function authServiceUrlTransform(content) {
  let next = replaceExactBlock(content, VERIFICATION_URL_BEFORE, VERIFICATION_URL_AFTER)
  next = replaceExactBlock(next, RESET_URL_BEFORE, RESET_URL_AFTER)
  return replaceExactBlock(next, VERIFY_URL_BEFORE, VERIFY_URL_AFTER)
}
