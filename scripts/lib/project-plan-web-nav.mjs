// Aggregates every init:project --mode=single step that rewrites a
// @/i18n/navigation call site (or, for oauth-exchange-handler.ts, a
// hand-built locale-prefixed URL with no @/i18n/navigation import at all).
import { buildWebNavLinkSteps } from './project-plan-web-nav-links.mjs'
import { buildWebNavHooksSteps } from './project-plan-web-nav-hooks.mjs'
import { buildWebNavLogoutSteps } from './project-plan-web-nav-logout.mjs'
import { buildWebNavBffSteps } from './project-plan-web-nav-bff.mjs'
import { buildWebNavOauthSteps } from './project-plan-web-nav-oauth.mjs'
import { buildWebNavAppShellSteps } from './project-plan-web-nav-appshell.mjs'
import { buildWebNavEslintGuardsSteps } from './project-plan-web-nav-eslint-guards.mjs'
import { buildWebNavDalGatingTestSteps } from './project-plan-web-nav-dal-gating-test.mjs'
import { buildWebNavDalOptionalTestSteps } from './project-plan-web-nav-dal-optional-test.mjs'

export function buildWebNavSteps(root) {
  return [
    ...buildWebNavLinkSteps(root),
    ...buildWebNavHooksSteps(root),
    ...buildWebNavLogoutSteps(root),
    ...buildWebNavBffSteps(root),
    ...buildWebNavOauthSteps(root),
    ...buildWebNavAppShellSteps(root),
    ...buildWebNavEslintGuardsSteps(root),
    ...buildWebNavDalGatingTestSteps(root),
    ...buildWebNavDalOptionalTestSteps(root),
  ]
}
