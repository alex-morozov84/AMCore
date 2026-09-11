// Aggregates every init:project --mode=single step that rewrites a
// @/i18n/navigation call site (or, for oauth-exchange-handler.ts, a
// hand-built locale-prefixed URL with no @/i18n/navigation import at all).
//
// use-logout.ts, primary-unavailable-fallback.tsx, AppShell.tsx's Link, and
// every real RouteProgressLink call site (LoginForm, ResetPasswordForm,
// VerifyEmailStatus, the auth _pages) are deliberately absent here even
// though some used to have their own steps: all were migrated to
// useRouteProgressRouter()/RouteProgressLink (P1 item 8), so once those two
// adapter files themselves are rewritten for single-locale mode (below),
// no call site needs any edit of its own -- the concern moved into the two
// adapters instead of staying duplicated per call site.
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
import { buildWebNavRouteProgressLinkSteps } from './project-plan-web-nav-route-progress-link.mjs'
import { buildWebNavRouteProgressLinkTestSteps } from './project-plan-web-nav-route-progress-link-test.mjs'
import { buildWebNavRouteProgressBarSteps } from './project-plan-web-nav-route-progress-bar.mjs'
import { buildWebNavRouteProgressBarTestSteps } from './project-plan-web-nav-route-progress-bar-test.mjs'

export function buildWebNavSteps(root) {
  return [
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
    ...buildWebNavRouteProgressLinkSteps(root),
    ...buildWebNavRouteProgressLinkTestSteps(root),
    ...buildWebNavRouteProgressBarSteps(root),
    ...buildWebNavRouteProgressBarTestSteps(root),
  ]
}
