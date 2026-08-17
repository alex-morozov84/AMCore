import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/test/**', 'src/**/*.d.ts'],
    },
    // Two named projects, not one shared config — the Storybook project runs
    // in real-browser mode (Playwright/Chromium), a fundamentally different
    // runtime from the jsdom unit project. Named explicitly so `--project`
    // filtering is unambiguous in both directions: `test`/`test:run` target
    // `unit` only (this repo's fast default suite), `test:storybook` targets
    // `storybook` only. Unnamed, a plain `vitest run` would run both.
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/**/*.{test,spec}.{ts,tsx}'],
          // Testcontainers-backed tests (real Redis, not mocked) run
          // separately via `pnpm test:integration` — needs Docker, too
          // slow/heavy for the default fast unit run. See
          // vitest.integration.config.ts.
          exclude: ['**/node_modules/**', 'src/**/*.integration.test.ts'],
        },
      },
      {
        extends: true,
        plugins: [
          // Turns every story into a Vitest test (a smoke render, plus any
          // `play` function's assertions) and runs addon-a11y's checks
          // inside the same run — see .storybook/preview.tsx's
          // `parameters.a11y.test`.
          storybookTest({
            configDir: path.join(dirname, '.storybook'),
          }),
        ],
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
