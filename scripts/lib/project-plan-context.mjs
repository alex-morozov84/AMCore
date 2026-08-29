// init:project --mode=single: PROJECT_CONTEXT.md's Frontend Starter Choices
// fields (mirrors brand-plan.mjs's buildContextSteps for init:brand's own
// fields). All three already exist in AMCore's shipped PROJECT_CONTEXT.md,
// so this only ever replaces a value in place — never inserts.
import path from 'node:path'
import { fileStep, markdownFieldsTransform } from './init-engine.mjs'

/**
 * Exported on its own (not just a buildContextSteps closure) so
 * project-plan-combined.mjs can combine it with storybookContextOps() into
 * one fileStep when --mode and --storybook are both given — see that
 * file's header for why two independent fileSteps on the same target
 * silently clobber each other.
 */
export function localeContextOps(locale) {
  return [
    { label: 'i18n_mode', value: 'single' },
    { label: 'base_locale', value: locale },
    { label: 'supported_locales', value: `[${locale}]` },
  ]
}

export function buildContextSteps(root, locale) {
  const projectContext = path.join(root, 'PROJECT_CONTEXT.md')
  const ops = localeContextOps(locale)
  return [
    fileStep(
      projectContext,
      markdownFieldsTransform(ops),
      'update i18n_mode/base_locale/supported_locales for single-locale mode'
    ),
  ]
}
