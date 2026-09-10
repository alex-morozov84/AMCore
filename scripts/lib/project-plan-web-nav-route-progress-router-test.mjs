// init:project --mode=single: use-route-progress-router.test.ts (P1
// item 8). Mocks next/navigation's useRouter instead of @/i18n/navigation's
// -- single-locale mode has no @/i18n/navigation to mock, and the real
// use-route-progress-router.ts (see its own transform) imports from
// next/navigation there too, so the mock target must follow it.
import path from 'node:path'
import { fileStep, replaceExactBlock } from './init-engine.mjs'

const BEFORE_BLOCK = `vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push, replace, back, forward, refresh, prefetch }),
}))
`

const AFTER_BLOCK = `vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace, back, forward, refresh, prefetch }),
}))
`

export function buildWebNavRouteProgressRouterTestSteps(root) {
  return [
    fileStep(
      path.join(root, 'apps/web/src/shared/lib/route-progress/use-route-progress-router.test.ts'),
      (content) => replaceExactBlock(content, BEFORE_BLOCK, AFTER_BLOCK),
      'use-route-progress-router.test.ts: mock next/navigation instead of @/i18n/navigation'
    ),
  ]
}
