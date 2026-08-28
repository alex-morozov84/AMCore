// When init:project's --mode and --storybook dimensions are both given in
// one invocation, two independent aggregators (project-plan.mjs and
// project-plan-storybook.mjs) each build their own fileStep for
// PROJECT_CONTEXT.md and apps/web/eslint.config.mjs — caught by
// project-plan.test.mjs's structural guard. fileStep reads its target once
// at plan-build time, so the second step's write() would silently discard
// the first step's change. Builds one combined fileStep per shared target
// instead, reusing each dimension's own exported transform/ops so neither
// side's logic is duplicated here.
import path from 'node:path'
import { fileStep, markdownFieldsTransform } from './init-engine.mjs'
import { localeContextOps } from './project-plan-context.mjs'
import { storybookContextOps } from './project-plan-storybook-context.mjs'
import { removeNavigationBanFromEslintConfig } from './project-plan-web-config.mjs'
import { removeStorybookFromEslintConfig } from './project-plan-storybook-eslint.mjs'

/** The absolute paths of every target this module takes over when both dimensions are active. */
export function combinedTargets(root) {
  return [path.join(root, 'PROJECT_CONTEXT.md'), path.join(root, 'apps/web/eslint.config.mjs')]
}

export function buildCombinedSteps(root, locale) {
  return [
    fileStep(
      path.join(root, 'PROJECT_CONTEXT.md'),
      markdownFieldsTransform([...localeContextOps(locale), ...storybookContextOps()]),
      'update PROJECT_CONTEXT.md fields (single-locale + storybook-disabled)'
    ),
    fileStep(
      path.join(root, 'apps/web/eslint.config.mjs'),
      (content) => removeStorybookFromEslintConfig(removeNavigationBanFromEslintConfig(content)),
      'apps/web/eslint.config.mjs: remove the navigation ban and the Storybook plugin/rules'
    ),
  ]
}
