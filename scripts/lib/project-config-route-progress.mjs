// Path/guard for init:project --route-progress=disabled (P1 item 8) — a
// separate file from project-config.mjs/project-config-storybook.mjs to stay
// under the repo's ~150-line-per-file guidance. Unlike the other two
// dimensions, this one is deliberately non-destructive (owner decision,
// 2026-09-09): it only flips a source flag's initial value, so its guard
// checks the flag's current value rather than a file's existence.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { EngineError, readMarkdownField } from './actions.mjs'

export const ROUTE_PROGRESS_VALUES = ['disabled']

export const ROUTE_PROGRESS_FLAG_PATH =
  'apps/web/src/shared/lib/route-progress/route-progress-flag.ts'

const ENABLED_LINE = 'export const ROUTE_PROGRESS_ENABLED = true'

/**
 * The reinitialize guard for this dimension, mirroring
 * assertStorybookEnabled's role for the storybook dimension: checks both
 * the flag file's own current value and PROJECT_CONTEXT.md's
 * frontend_route_progress field, since either alone could be stale if a
 * checkout was hand-edited.
 */
export function assertRouteProgressEnabled(root) {
  const flagPath = path.join(root, ROUTE_PROGRESS_FLAG_PATH)
  const flagContent = readFileSync(flagPath, 'utf8')
  if (!flagContent.includes(ENABLED_LINE)) {
    throw new EngineError(
      `${flagPath} does not declare "${ENABLED_LINE}" — either ` +
        'init:project --route-progress=disabled has already been applied to this checkout, ' +
        'or the flag was hand-edited to false.'
    )
  }

  const contextPath = path.join(root, 'PROJECT_CONTEXT.md')
  const context = readFileSync(contextPath, 'utf8')
  const field = readMarkdownField(context, 'frontend_route_progress')
  if (field === 'disabled') {
    throw new EngineError(
      `${contextPath} already declares frontend_route_progress: disabled, but ${flagPath} ` +
        'still says true — the checkout is in an inconsistent state; resolve that by hand ' +
        'before re-running.'
    )
  }
}
