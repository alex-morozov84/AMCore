import { jsonDeleteTransform } from './content-transforms.mjs'

export const STORYBOOK_PACKAGE_PATHS = Object.freeze([
  'scripts.test:storybook',
  'scripts.storybook',
  'scripts.build-storybook',
  'devDependencies.@storybook/addon-a11y',
  'devDependencies.@storybook/addon-docs',
  'devDependencies.@storybook/addon-themes',
  'devDependencies.@storybook/addon-vitest',
  'devDependencies.@storybook/nextjs-vite',
  'devDependencies.@vitest/browser-playwright',
  'devDependencies.eslint-plugin-storybook',
  'devDependencies.msw-storybook-addon',
  'devDependencies.storybook',
  'devDependencies.path-to-regexp',
])

export function removeStorybookPackage(content) {
  return jsonDeleteTransform(STORYBOOK_PACKAGE_PATHS)(content)
}

export function removeConsolePackage(content) {
  return jsonDeleteTransform(['scripts.test:e2e:console-real-stack'])(content)
}

export function removeConsoleMessages(content) {
  return jsonDeleteTransform(['console'])(content)
}
