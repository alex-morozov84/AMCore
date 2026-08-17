import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { StorybookConfig } from '@storybook/nextjs-vite'

// Resolves an addon/framework package's absolute path — required in a pnpm
// monorepo (strict node_modules linking) rather than passing bare package
// names, which Storybook's own generator uses for exactly this reason.
function getAbsolutePath(value: string): string {
  return dirname(fileURLToPath(import.meta.resolve(`${value}/package.json`)))
}

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: [
    getAbsolutePath('@storybook/addon-docs'),
    getAbsolutePath('@storybook/addon-a11y'),
    getAbsolutePath('@storybook/addon-vitest'),
    getAbsolutePath('@storybook/addon-themes'),
    // Not getAbsolutePath() here: msw-storybook-addon's package.json
    // `exports` map has no `./package.json` entry, so
    // `import.meta.resolve('msw-storybook-addon/package.json')` throws
    // ERR_PACKAGE_PATH_NOT_EXPORTED (confirmed live). The bare specifier
    // resolves fine — this is what the addon's own README shows too.
    'msw-storybook-addon',
  ],
  framework: getAbsolutePath('@storybook/nextjs-vite'),
  staticDirs: ['../public'],
  // A starter shouldn't phone home for downstream forks by default.
  core: {
    disableTelemetry: true,
  },
}

export default config
