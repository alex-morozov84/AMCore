// Shared recipe constants for the scaffold scenarios that verify manually
// (spawn pnpm commands directly) instead of through the CLI's own
// runProjectVerification. Both the real end-to-end tests
// (scripts/init-project-*.test.mjs) and scripts/measure/scenario-registry.mjs
// import these same arrays — one source, not two hand-synchronized copies.
// BACKLOG item 14, PR1 correction: a duplicated copy in scenario-registry.mjs
// had drifted, omitting the API test step and reordering the rest, with
// nothing catching it because each copy's own tests stayed green.

/** scripts/init-project-storybook.test.mjs's post-install manual verify. */
export const STORYBOOK_MANUAL_VERIFY_STEPS = [
  ['typecheck'],
  ['lint'],
  ['--filter', 'web', 'build'],
  ['--filter', 'api', 'test'],
  ['--filter', 'web', 'test'],
]

/** scripts/init-project-admin-console.test.mjs's verifyGeneratedWeb(). */
export const ADMIN_CONSOLE_VERIFY_STEPS = [
  ['typecheck'],
  ['lint'],
  ['--filter', 'web', 'test'],
  ['--filter', 'web', 'build'],
]

/** scripts/init-project-admin-console.test.mjs's enabled-topology loop cardinality. */
export const ADMIN_CONSOLE_ENABLED_TOPOLOGIES = [
  ['path', 'panel'],
  ['host', 'panel'],
]

/** scripts/init-project-admin-console-single-locale.test.mjs's buildWeb(). */
export const ADMIN_CONSOLE_SINGLE_LOCALE_BUILD_STEPS = [
  ['--filter', 'shared', 'build'],
  ['--filter', 'web', 'build'],
]

/** scripts/init-project-admin-console-single-locale.test.mjs's representative-scenarios loop cardinality. */
export const ADMIN_CONSOLE_SINGLE_LOCALE_REPRESENTATIVE_SCENARIOS = [
  ['ru', ['--admin-console=host', '--admin-console-slug=panel'], { mode: 'host', slug: 'panel' }],
  ['en', ['--admin-console=disabled'], { mode: 'disabled' }],
]
