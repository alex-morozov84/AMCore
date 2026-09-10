/**
 * Single reversible on/off switch for the top route-progress bar. Not a
 * runtime/user preference (owner decision, 2026-09-09 — see
 * `docs/frontend/route-progress.md`): a developer or agent edits this file
 * directly to enable/disable the feature after scaffolding, no rebuild of
 * anything else required. `pnpm init:project --route-progress=disabled`
 * only sets this const's *initial* value to `false` and records the choice
 * in `PROJECT_CONTEXT.md` — it never deletes this file or any other part of
 * the feature. Flipping it back to `true` by hand fully restores the bar.
 */
export const ROUTE_PROGRESS_ENABLED = true
