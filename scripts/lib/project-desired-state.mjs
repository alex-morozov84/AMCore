import { readFileSync } from 'node:fs'
import path from 'node:path'

import { EngineError } from './actions.mjs'

function field(content, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = [...content.matchAll(new RegExp(`^- \\*\\*${escaped}:\\*\\* (.*)$`, 'gm'))]
  if (matches.length !== 1) {
    throw new EngineError(
      `expected exactly one PROJECT_CONTEXT.md field "${label}", found ${matches.length}`
    )
  }
  return matches[0][1]
}

function currentState(root) {
  const content = readFileSync(path.join(root, 'PROJECT_CONTEXT.md'), 'utf8')
  const consoleEnabled = field(content, 'admin_console') === 'enabled'
  return {
    locale: { mode: field(content, 'i18n_mode'), base: field(content, 'base_locale') },
    storybook: field(content, 'frontend_storybook'),
    routeProgress: field(content, 'frontend_route_progress'),
    adminConsole: consoleEnabled
      ? {
          enabled: true,
          mode: field(content, 'admin_console_mode'),
          slug: field(content, 'admin_console_slug'),
        }
      : { enabled: false },
  }
}

export function buildProjectDesiredState(root, flags, adminConsoleSlug) {
  const current = currentState(root)
  const selected = Object.freeze({
    locale: Boolean(flags.mode),
    storybook: Boolean(flags.storybook),
    routeProgress: Boolean(flags['route-progress']),
    adminConsole: Boolean(flags['admin-console']),
  })
  return Object.freeze({
    selected,
    locale: selected.locale ? { mode: 'single', base: flags.locale } : current.locale,
    storybook: selected.storybook ? 'disabled' : current.storybook,
    routeProgress: selected.routeProgress ? 'disabled' : current.routeProgress,
    adminConsole: selected.adminConsole
      ? flags['admin-console'] === 'disabled'
        ? { enabled: false }
        : { enabled: true, mode: flags['admin-console'], slug: adminConsoleSlug }
      : current.adminConsole,
  })
}
