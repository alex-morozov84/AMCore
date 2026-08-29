// init:project --storybook=disabled: apps/web/eslint.config.mjs's
// Storybook-specific import, ignore entry, and rules block.
import path from 'node:path'
import { fileStep, removeExactBlock } from './init-engine.mjs'

const IMPORT_LINE = "import storybookPlugin from 'eslint-plugin-storybook';\n"

const IGNORE_ENTRY = "      'storybook-static/**',\n"

const RULES_BLOCK = `
  // Storybook rules — story-file/\`.storybook/main.ts\` linting from the
  // plugin's own recommended flat config, not hand-restated here.
  ...storybookPlugin.configs['flat/recommended'],
`

/**
 * Exported on its own (not just a buildStorybookEslintSteps closure) so
 * project-plan-combined.mjs can compose it with
 * removeNavigationBanFromEslintConfig into one fileStep when --mode and
 * --storybook are both given — see that file's header for why two
 * independent fileSteps on the same target silently clobber each other.
 */
export function removeStorybookFromEslintConfig(content) {
  let next = removeExactBlock(content, IMPORT_LINE)
  next = removeExactBlock(next, IGNORE_ENTRY)
  return removeExactBlock(next, RULES_BLOCK)
}

export function buildStorybookEslintSteps(root) {
  return [
    fileStep(
      path.join(root, 'apps/web/eslint.config.mjs'),
      removeStorybookFromEslintConfig,
      'apps/web/eslint.config.mjs: remove the Storybook plugin import, ignore entry, and rules block'
    ),
  ]
}
