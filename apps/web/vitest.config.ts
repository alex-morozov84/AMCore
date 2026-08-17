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
        optimizeDeps: {
          include: [
            // msw's browser handler-matching pulls in `path-to-regexp`, a
            // CJS package. Without this, Vitest's browser mode serves it
            // raw via `/@fs/` instead of pre-bundling it, and the browser's
            // real ESM loader then fails on `exports.match = ...` with
            // "does not provide an export named 'match'" — confirmed live
            // once msw-storybook-addon was wired in (PR3).
            // `optimizeDeps.include` alone isn't enough in this pnpm
            // monorepo: it's a transitive-only package (via `msw`), not
            // resolvable as a bare specifier from `apps/web`'s own
            // node_modules — hence the direct `path-to-regexp`
            // devDependency in package.json, pinned to the same version
            // pnpm already resolves elsewhere in the workspace, purely so
            // Vite's optimizer can find it.
            'path-to-regexp',
            // First-time discovery of these mid-run (once real component
            // stories existed, PR4) triggered "Vite unexpectedly reloaded a
            // test" and cascading failures on a cold run — Vite's own
            // logged suggestion was to list them here explicitly. All are
            // direct `apps/web` dependencies, so no monorepo-resolution
            // workaround needed, unlike `path-to-regexp` above.
            '@base-ui/react/button',
            '@hookform/resolvers/zod',
            '@radix-ui/react-slot',
            'class-variance-authority',
            'lucide-react',
            'react-hook-form',
          ],
        },
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
