/**
 * Single reversible on/off switch for the top route-progress bar. Not a
 * runtime/user preference (owner decision, 2026-09-09 — see
 * `docs/frontend/route-progress.md`): a developer or agent edits this file
 * directly to enable/disable the feature (a normal application rebuild/deploy
 * still applies) and records the choice in `PROJECT_CONTEXT.md`. Setting it to
 * `false` never deletes this file or any other part of the feature. Flipping it
 * back to `true` by hand fully restores the bar.
 */
export const ROUTE_PROGRESS_ENABLED = true
