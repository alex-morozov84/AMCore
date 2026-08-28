// init:project --storybook=disabled: PROJECT_CONTEXT.md's frontend_storybook
// field (mirrors project-plan-context.mjs's role for the locale dimension)
// AND the "Frontend Starter Choices" bullet that documents it. The bullet
// links to docs/frontend/storybook.md, which this same dimension deletes
// (project-plan-storybook-docs.mjs) — left alone, that link would be a
// documented reference to a file this exact apply just removed. Found by
// Agent 2's apply-smoke review, not caught by any structural test.
import path from 'node:path'
import { fileStep, markdownFieldsTransform, replaceExactBlock } from './init-engine.mjs'

/**
 * Exported on its own (not just a buildStorybookContextSteps closure) so
 * project-plan-combined.mjs can combine it with localeContextOps() into
 * one fileStep when --mode and --storybook are both given — see that
 * file's header for why two independent fileSteps on the same target
 * silently clobber each other.
 */
export function storybookContextOps() {
  return [{ label: 'frontend_storybook', value: 'disabled' }]
}

const BULLET_BEFORE = `- **\`frontend_storybook\`:** \`enabled\` or \`disabled\`. AMCore upstream keeps
  Storybook mandatory (CI \`storybook\` job, \`build-storybook\` +
  \`test:storybook\`) as the default — see \`docs/frontend/storybook.md\`. A
  \`disabled\` choice is a one-time removal of \`.storybook/\`, co-located
  stories, Storybook scripts/dependencies, the CI job, and Storybook-specific
  public docs, not a \`SKIP_STORYBOOK\` bypass that leaves the surface present
  but unused.`

const BULLET_AFTER = `- **\`frontend_storybook\`:** \`enabled\` or \`disabled\`. AMCore upstream keeps
  Storybook mandatory (CI \`storybook\` job, \`build-storybook\` +
  \`test:storybook\`) as the default. This fork has disabled it: \`.storybook/\`,
  co-located stories, Storybook scripts/dependencies, the CI job, and
  Storybook-specific public docs were removed in a one-time pass, not a
  \`SKIP_STORYBOOK\` bypass that would have left the surface present but
  unused.`

/**
 * Exported on its own for the same reason as storybookContextOps() —
 * project-plan-combined.mjs composes it too.
 */
export function removeStorybookDocLinkFromContext(content) {
  return replaceExactBlock(content, BULLET_BEFORE, BULLET_AFTER)
}

export function buildStorybookContextSteps(root) {
  return [
    fileStep(
      path.join(root, 'PROJECT_CONTEXT.md'),
      (content) =>
        removeStorybookDocLinkFromContext(markdownFieldsTransform(storybookContextOps())(content)),
      'update frontend_storybook for the disabled choice and drop the dead doc link'
    ),
  ]
}
