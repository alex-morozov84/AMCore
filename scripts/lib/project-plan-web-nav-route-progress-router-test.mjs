// init:project --mode=single: use-route-progress-router.test.ts (P1
// item 8). Mocks next/navigation's useRouter instead of @/i18n/navigation's
// -- single-locale mode has no @/i18n/navigation to mock, and the real
// use-route-progress-router.ts (see its own transform) imports from
// next/navigation there too, so the mock target must follow it. Also drops
// the `{ locale: 'ru' }` push option: plain next/navigation's
// `NavigateOptions` has no `locale` field (that's next-intl's own
// extension), so single-locale mode fails `tsc` on it -- found via the
// real `pnpm --filter web build` in init-project.test.mjs, missed when
// this test was first written since it predates single-locale mode ever
// running this file to completion.
import path from 'node:path'
import { fileStep, replaceExactBlock } from './init-engine.mjs'

const MOCK_BEFORE_BLOCK = `vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push, replace, back, forward, refresh, prefetch }),
}))
`

const MOCK_AFTER_BLOCK = `vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace, back, forward, refresh, prefetch }),
}))
`

const PUSH_TEST_BEFORE = `  it('starts the controller and delegates on push', () => {
    const { result } = renderHook(() => useRouteProgressRouter())
    result.current.push('/somewhere', { locale: 'ru' })
    expect(routeProgressController.getPhase()).not.toBe('idle')
    expect(push).toHaveBeenCalledWith('/somewhere', { locale: 'ru' })
  })
`

const PUSH_TEST_AFTER = `  it('starts the controller and delegates on push', () => {
    const { result } = renderHook(() => useRouteProgressRouter())
    result.current.push('/somewhere')
    expect(routeProgressController.getPhase()).not.toBe('idle')
    expect(push).toHaveBeenCalledWith('/somewhere')
  })
`

function routerTestTransform(content) {
  const next = replaceExactBlock(content, MOCK_BEFORE_BLOCK, MOCK_AFTER_BLOCK)
  return replaceExactBlock(next, PUSH_TEST_BEFORE, PUSH_TEST_AFTER)
}

export function buildWebNavRouteProgressRouterTestSteps(root) {
  return [
    fileStep(
      path.join(root, 'apps/web/src/shared/lib/route-progress/use-route-progress-router.test.ts'),
      routerTestTransform,
      'use-route-progress-router.test.ts: mock next/navigation instead of @/i18n/navigation, drop the locale push option'
    ),
  ]
}
