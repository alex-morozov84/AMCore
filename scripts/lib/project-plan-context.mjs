// init:project --mode=single: PROJECT_CONTEXT.md's Frontend Starter Choices
// fields (mirrors brand-plan.mjs's buildContextSteps for init:brand's own
// fields). All three already exist in AMCore's shipped PROJECT_CONTEXT.md,
// so this only ever replaces a value in place — never inserts.
import path from 'node:path'
import { fileStep, markdownFieldsTransform } from './init-engine.mjs'

export function buildContextSteps(root, locale) {
  const projectContext = path.join(root, 'PROJECT_CONTEXT.md')
  const ops = [
    { label: 'i18n_mode', value: 'single' },
    { label: 'base_locale', value: locale },
    { label: 'supported_locales', value: `[${locale}]` },
  ]
  return [
    fileStep(
      projectContext,
      markdownFieldsTransform(ops),
      'update i18n_mode/base_locale/supported_locales for single-locale mode'
    ),
  ]
}
