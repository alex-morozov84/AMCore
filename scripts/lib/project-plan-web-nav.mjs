// Aggregates every init:project --mode=single step that rewrites a
// @/i18n/navigation call site (or, for oauth-exchange-handler.ts, a
// hand-built locale-prefixed URL with no @/i18n/navigation import at all).
//
// use-logout.ts and primary-unavailable-fallback.tsx are deliberately absent
// here even though they used to have their own steps: both were migrated to
// useRouteProgressRouter() (P1 item 8) and call only push()-less/option-less
// router methods (push('/login') with no locale, refresh()), so once
// use-route-progress-router.ts itself is rewritten for single-locale mode
// (below), neither call site needs any edit of its own -- the concern moved
// into the one adapter file instead of staying duplicated per call site.
import { buildWebNavLinkSteps } from './project-plan-web-nav-links.mjs'
import { buildWebNavHooksSteps } from './project-plan-web-nav-hooks.mjs'
import { buildWebNavBffSteps } from './project-plan-web-nav-bff.mjs'
import { buildWebNavOauthSteps } from './project-plan-web-nav-oauth.mjs'
import { buildWebNavOauthTestSteps } from './project-plan-web-nav-oauth-test.mjs'
import { buildWebNavAppShellSteps } from './project-plan-web-nav-appshell.mjs'
import { buildWebNavEslintGuardsSteps } from './project-plan-web-nav-eslint-guards.mjs'
import { buildWebNavDalGatingTestSteps } from './project-plan-web-nav-dal-gating-test.mjs'
import { buildWebNavDalOptionalTestSteps } from './project-plan-web-nav-dal-optional-test.mjs'
import { buildWebNavRouteProgressRouterSteps } from './project-plan-web-nav-route-progress-router.mjs'
import { buildWebNavRouteProgressRouterTestSteps } from './project-plan-web-nav-route-progress-router-test.mjs'
import { buildWebNavRouteProgressBarSteps } from './project-plan-web-nav-route-progress-bar.mjs'
import { buildWebNavRouteProgressBarTestSteps } from './project-plan-web-nav-route-progress-bar-test.mjs'
import { buildWebNavRouteProgressBarStoriesSteps } from './project-plan-web-nav-route-progress-bar-stories.mjs'

export function buildWebNavSteps(root) {
  return [
    ...buildWebNavLinkSteps(root),
    ...buildWebNavHooksSteps(root),
    ...buildWebNavBffSteps(root),
    ...buildWebNavOauthSteps(root),
    ...buildWebNavOauthTestSteps(root),
    ...buildWebNavAppShellSteps(root),
    ...buildWebNavEslintGuardsSteps(root),
    ...buildWebNavDalGatingTestSteps(root),
    ...buildWebNavDalOptionalTestSteps(root),
    ...buildWebNavRouteProgressRouterSteps(root),
    ...buildWebNavRouteProgressRouterTestSteps(root),
    ...buildWebNavRouteProgressBarSteps(root),
    ...buildWebNavRouteProgressBarTestSteps(root),
    ...buildWebNavRouteProgressBarStoriesSteps(root),
  ]
}
