// init:project's CLI flag parsing/validation, split out of init-project.mjs
// to stay under the repo's ~150-line-per-file guidance.
import { EngineError, parseCommonFlags } from './init-engine.mjs'
import { PROJECT_MODES } from './project-config.mjs'
import { STORYBOOK_VALUES } from './project-config-storybook.mjs'
import { ROUTE_PROGRESS_VALUES } from './project-config-route-progress.mjs'
import { ADMIN_CONSOLE_VALUES } from './project-config-admin-console.mjs'

export function parseProjectFlags(argv) {
  const flags = parseCommonFlags(argv, {
    mode: { type: 'string' },
    locale: { type: 'string' },
    storybook: { type: 'string' },
    'route-progress': { type: 'string' },
    'admin-console': { type: 'string' },
    'admin-console-slug': { type: 'string' },
  })

  if (!flags.mode && !flags.storybook && !flags['route-progress'] && !flags['admin-console']) {
    throw new EngineError(
      'at least one of --mode, --storybook, --route-progress, or --admin-console is required, e.g. ' +
        '--mode=single --locale=en, --storybook=disabled, --route-progress=disabled, --admin-console=disabled, ' +
        'or any combination together'
    )
  }

  if (flags.mode) {
    if (!PROJECT_MODES.includes(flags.mode)) {
      throw new EngineError(`--mode=${flags.mode} is not one of: ${PROJECT_MODES.join(', ')}`)
    }
    if (!flags.locale) {
      throw new EngineError('--locale is required when --mode is given, e.g. --locale=en')
    }
  }

  if (flags.storybook && !STORYBOOK_VALUES.includes(flags.storybook)) {
    throw new EngineError(
      `--storybook=${flags.storybook} is not one of: ${STORYBOOK_VALUES.join(', ')}`
    )
  }

  if (flags['route-progress'] && !ROUTE_PROGRESS_VALUES.includes(flags['route-progress'])) {
    throw new EngineError(
      `--route-progress=${flags['route-progress']} is not one of: ${ROUTE_PROGRESS_VALUES.join(', ')}`
    )
  }

  if (flags['admin-console'] && !ADMIN_CONSOLE_VALUES.includes(flags['admin-console'])) {
    throw new EngineError(
      `--admin-console=${flags['admin-console']} is not one of: ${ADMIN_CONSOLE_VALUES.join(', ')}`
    )
  }
  if (flags['admin-console-slug'] && !flags['admin-console']) {
    throw new EngineError('--admin-console-slug requires --admin-console')
  }
  if (flags['admin-console'] === 'disabled' && flags['admin-console-slug']) {
    throw new EngineError('--admin-console-slug cannot be used with --admin-console=disabled')
  }

  return flags
}
