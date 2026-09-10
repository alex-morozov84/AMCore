// init:project --mode=single: packages/shared/src/lib/frontend-url.test.ts.
// Originally targeted apps/api/src/core/auth/frontend-url.spec.ts, but PR #376
// (the packages/shared test runner, ai/STATUS.md 2026-09-05) moved this suite
// beside its source and converted it to Vitest -- the plan drifted because
// this transform was never updated to follow. `localizedFrontendUrl` is
// exercised with a hardcoded 'ru' locale throughout its describe block;
// rewritten to use DEFAULT_LOCALE (already imported, and reflecting whichever
// locale was actually chosen) instead of a second hardcoded literal -- no
// locale branching needed in this generator, since the test content itself is
// now locale-generic. One assertion in the sibling `localePathPrefix` describe
// block (added in PR3A specifically to stay independently testable -- see
// that function's own doc comment) still hardcodes a bare 'ru' as the *typed*
// first argument, which is a real SupportedLocale position, not a plain string
// array entry -- dropped, since the first assertion already proves the "more
// than one locale" branch. The before/after text itself lives in
// project-plan-shared-frontend-url-test-content.mjs for the same line-count reason.
import path from 'node:path'
import { exactContentStep } from './init-engine.mjs'
import {
  FRONTEND_URL_TEST_BEFORE,
  FRONTEND_URL_TEST_AFTER,
} from './project-plan-shared-frontend-url-test-content.mjs'

export function buildSharedFrontendUrlTestSteps(root) {
  return [
    exactContentStep(
      path.join(root, 'packages/shared/src/lib/frontend-url.test.ts'),
      { expectedBefore: FRONTEND_URL_TEST_BEFORE, after: FRONTEND_URL_TEST_AFTER },
      'frontend-url.test.ts: use DEFAULT_LOCALE generically instead of a hardcoded second locale'
    ),
  ]
}
