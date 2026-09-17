import { markdownFieldsTransform } from './content-transforms.mjs'
import { removeMarkdownFields } from './actions.mjs'
import { replaceExactBlock } from './content-blocks.mjs'

const STORYBOOK_BEFORE = `- **\`frontend_storybook\`:** \`enabled\` or \`disabled\`. AMCore upstream keeps
  Storybook mandatory (CI \`storybook\` job, \`build-storybook\` +
  \`test:storybook\`) as the default — see \`docs/frontend/storybook.md\`. A
  \`disabled\` choice is a one-time removal of \`.storybook/\`, co-located
  stories, Storybook scripts/dependencies, the CI job, and Storybook-specific
  public docs, not a \`SKIP_STORYBOOK\` bypass that leaves the surface present
  but unused.`

const STORYBOOK_AFTER = `- **\`frontend_storybook\`:** \`enabled\` or \`disabled\`. AMCore upstream keeps
  Storybook mandatory (CI \`storybook\` job, \`build-storybook\` +
  \`test:storybook\`) as the default. This fork has disabled it: \`.storybook/\`,
  co-located stories, Storybook scripts/dependencies, the CI job, and
  Storybook-specific public docs were removed in a one-time pass, not a
  \`SKIP_STORYBOOK\` bypass that would have left the surface present but
  unused.`

export function applyLocaleContext(content, locale) {
  return markdownFieldsTransform([
    { label: 'i18n_mode', value: 'single' },
    { label: 'base_locale', value: locale },
    { label: 'supported_locales', value: `[${locale}]` },
  ])(content)
}

export function applyStorybookContext(content) {
  const fields = markdownFieldsTransform([{ label: 'frontend_storybook', value: 'disabled' }])(
    content
  )
  return replaceExactBlock(fields, STORYBOOK_BEFORE, STORYBOOK_AFTER)
}

export function applyRouteProgressContext(content) {
  return markdownFieldsTransform([{ label: 'frontend_route_progress', value: 'disabled' }])(content)
}

export function applyConsoleContext(content, params) {
  if (!params.enabled) {
    const updated = markdownFieldsTransform([{ label: 'admin_console', value: 'disabled' }])(
      content
    )
    return removeMarkdownFields(updated, ['admin_console_mode', 'admin_console_slug'])
  }
  return markdownFieldsTransform([
    { label: 'admin_console', value: 'enabled' },
    { label: 'admin_console_mode', value: params.mode },
    { label: 'admin_console_slug', value: params.slug },
  ])(content)
}
