// init:project --mode=single: dal.optional-session.test.ts carries two mocks
// that become dead once project-plan-web-nav-bff.mjs's dal.ts rewrite drops
// its next-intl/server and @/i18n/navigation imports — getOptionalSession()
// never called either, so this is cleanup, not a behavioural change.
import path from 'node:path'
import { fileStep, removeExactBlock } from './init-engine.mjs'

const DEAD_MOCKS_BLOCK = `vi.mock('next-intl/server', () => ({ getLocale: vi.fn().mockResolvedValue('en') }))
vi.mock('@/i18n/navigation', () => ({ redirect: vi.fn() }))
`

export function buildWebNavDalOptionalTestSteps(root) {
  return [
    fileStep(
      path.join(root, 'apps/web/src/shared/api/bff/dal.optional-session.test.ts'),
      (content) => removeExactBlock(content, DEAD_MOCKS_BLOCK),
      'dal.optional-session.test.ts: drop the now-dead next-intl/server and @/i18n/navigation mocks'
    ),
  ]
}
