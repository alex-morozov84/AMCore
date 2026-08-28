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

function transform(content) {
  let next = removeExactBlock(content, IMPORT_LINE)
  next = removeExactBlock(next, IGNORE_ENTRY)
  return removeExactBlock(next, RULES_BLOCK)
}

export function buildStorybookEslintSteps(root) {
  return [
    fileStep(
      path.join(root, 'apps/web/eslint.config.mjs'),
      transform,
      'apps/web/eslint.config.mjs: remove the Storybook plugin import, ignore entry, and rules block'
    ),
  ]
}
