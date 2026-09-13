// PROJECT_CONTEXT.md operations for the console dimension and combined plans.
import path from 'node:path'
import { fileStep, markdownFieldsTransform, removeMarkdownFields } from './init-engine.mjs'

export function adminConsoleContextOps({ mode, slug }) {
  if (mode === 'disabled') return [{ label: 'admin_console', value: 'disabled' }]
  return [
    { label: 'admin_console', value: 'enabled' },
    { label: 'admin_console_mode', value: mode },
    { label: 'admin_console_slug', value: slug },
  ]
}

export function transformAdminConsoleContext(content, choice) {
  const updated = markdownFieldsTransform(adminConsoleContextOps(choice))(content)
  return choice.mode === 'disabled'
    ? removeMarkdownFields(updated, ['admin_console_mode', 'admin_console_slug'])
    : updated
}

export function buildAdminConsoleContextSteps(root, choice) {
  return [
    fileStep(
      path.join(root, 'PROJECT_CONTEXT.md'),
      (content) => transformAdminConsoleContext(content, choice),
      'record the Operations Console scaffold choice'
    ),
  ]
}
