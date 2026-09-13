// When 2+ of init:project's independent dimensions (--mode, --storybook,
// --route-progress, --admin-console) are given in one invocation, more than one
// dimension-specific aggregator builds its own fileStep for the same target
// file — fileStep reads its target once at plan-build time, so the second
// step's write() would silently discard the first step's change (caught by
// project-plan.test.mjs's structural guard). Builds one combined fileStep
// per shared target instead, reusing each dimension's own exported
// transform/ops so no dimension's logic is duplicated here.
//
// PROJECT_CONTEXT.md is shared by all dimensions; apps/web/
// eslint.config.mjs only by --mode and --storybook (--route-progress never
// touches it) — the two targets are combined independently, not as one
// "all three at once" case, so any subset of 2 or 3 dimensions composes
// correctly (FINAL PLAN item 10: "generalize only as far as needed").
import path from 'node:path'
import { fileStep, markdownFieldsTransform } from './init-engine.mjs'
import { localeContextOps } from './project-plan-context.mjs'
import {
  storybookContextOps,
  removeStorybookDocLinkFromContext,
} from './project-plan-storybook-context.mjs'
import { routeProgressContextOps } from './project-plan-route-progress-context.mjs'
import { transformAdminConsoleContext } from './project-plan-admin-console-context.mjs'
import { removeConsolePackageScript } from './project-plan-admin-console-disable-web.mjs'
import {
  removeConsoleArchitectureSection,
  removeConsoleFrontendIndexRow,
} from './project-plan-admin-console-disable-docs.mjs'
import { removeNavigationBanFromEslintConfig } from './project-plan-web-config.mjs'
import { removeStorybookFromEslintConfig } from './project-plan-storybook-eslint.mjs'
import { removeStorybookFromPackage } from './project-plan-storybook-package.mjs'
import { removeStorybookFromFrontendReadme } from './project-plan-storybook-docs-frontend-readme.mjs'
import { removeStorybookArchitectureBullet } from './project-plan-storybook-docs-misc.mjs'

/**
 * Which shared targets need a combined step for this exact set of active
 * dimensions. `dims`: `{ locale?: string, storybook?: boolean,
 * routeProgress?: boolean, adminConsole?: object }` — an absent/falsy key means that dimension
 * was not requested.
 */
export function combinedTargets(root, dims) {
  const targets = []
  const contextDimensionCount = [
    dims.locale,
    dims.storybook,
    dims.routeProgress,
    dims.adminConsole,
  ].filter(Boolean).length
  if (contextDimensionCount >= 2) {
    targets.push(path.join(root, 'PROJECT_CONTEXT.md'))
  }
  if (dims.locale && dims.storybook) {
    targets.push(path.join(root, 'apps/web/eslint.config.mjs'))
  }
  if (dims.storybook && dims.adminConsole?.mode === 'disabled') {
    targets.push(
      path.join(root, 'apps/web/package.json'),
      path.join(root, 'docs/frontend/architecture-and-conventions.md'),
      path.join(root, 'docs/frontend/README.md')
    )
  }
  return targets
}

export function buildCombinedSteps(root, dims) {
  const steps = []
  const contextDimensionCount = [
    dims.locale,
    dims.storybook,
    dims.routeProgress,
    dims.adminConsole,
  ].filter(Boolean).length

  if (contextDimensionCount >= 2) {
    const ops = [
      ...(dims.locale ? localeContextOps(dims.locale) : []),
      ...(dims.storybook ? storybookContextOps() : []),
      ...(dims.routeProgress ? routeProgressContextOps() : []),
    ]
    steps.push(
      fileStep(
        path.join(root, 'PROJECT_CONTEXT.md'),
        (content) => {
          const withFields = markdownFieldsTransform(ops)(content)
          const withoutStorybookLink = dims.storybook
            ? removeStorybookDocLinkFromContext(withFields)
            : withFields
          return dims.adminConsole
            ? transformAdminConsoleContext(withoutStorybookLink, dims.adminConsole)
            : withoutStorybookLink
        },
        'update PROJECT_CONTEXT.md fields for the combined dimensions'
      )
    )
  }

  if (dims.locale && dims.storybook) {
    steps.push(
      fileStep(
        path.join(root, 'apps/web/eslint.config.mjs'),
        (content) => removeStorybookFromEslintConfig(removeNavigationBanFromEslintConfig(content)),
        'apps/web/eslint.config.mjs: remove the navigation ban and the Storybook plugin/rules'
      )
    )
  }

  if (dims.storybook && dims.adminConsole?.mode === 'disabled') {
    steps.push(
      fileStep(
        path.join(root, 'apps/web/package.json'),
        (content) => removeConsolePackageScript(removeStorybookFromPackage(content)),
        'apps/web/package.json: remove the Storybook and console-only test scripts'
      ),
      fileStep(
        path.join(root, 'docs/frontend/architecture-and-conventions.md'),
        (content) => removeConsoleArchitectureSection(removeStorybookArchitectureBullet(content)),
        'architecture-and-conventions.md: remove Storybook and console-only documentation'
      ),
      fileStep(
        path.join(root, 'docs/frontend/README.md'),
        (content) => removeConsoleFrontendIndexRow(removeStorybookFromFrontendReadme(content)),
        'docs/frontend/README.md: remove Storybook and console-only index entries'
      )
    )
  }

  return steps
}
