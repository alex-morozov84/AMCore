// init:project --storybook=disabled: removes the two sentinel-bounded CI
// blocks PR1 planted specifically for this transform (ADR-071) — the whole
// `storybook` job in ci.yml, and the Storybook-only Dependency Review
// allowlist entry.
import path from 'node:path'
import { fileStep, removeExactBlock } from './init-engine.mjs'

const CI_JOB_BLOCK = `  # amcore:sentinel-block start=storybook-job
  storybook:
    name: Storybook
    runs-on: ubuntu-latest
    needs: [lint, typecheck]
    # No job in this file previously set this; added here after a real
    # incident (2026-08-18, PR #329's first run) where \`apt-get install\`
    # (invoked internally by \`playwright install --with-deps\`) hung on an
    # unanswered interactive prompt — a known needrestart/Ubuntu-runner issue
    # that ignores DEBIAN_FRONTEND on its own apt post-invoke hook — and ran
    # until GitHub's default 6-hour job timeout killed it instead of failing
    # fast. \`web-e2e\` runs the identical install command and shared this
    # exposure until it got the same fix (timeout-minutes + env vars on its
    # own install step) per the ai/BACKLOG.md follow-up.
    timeout-minutes: 20
    steps:
      - name: Checkout
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false

      - name: Setup pnpm
        uses: pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86 # v6.0.10

      - name: Setup Node.js
        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 24
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      # Stories import @amcore/shared directly (AuthErrorCode, DEFAULT_LOCALE);
      # apps/web resolves it through its built dist, same reasoning as
      # web-e2e's own "Build @amcore/shared" step.
      - name: Build @amcore/shared
        run: pnpm --filter @amcore/shared build

      # No Docker/real-stack needed here — every story's API surface is
      # mocked via msw-storybook-addon, not a real apps/api. Much lighter
      # than web-e2e for that reason.
      #
      # DEBIAN_FRONTEND/NEEDRESTART_MODE: \`--with-deps\` runs \`sudo apt-get
      # install\` for Chromium's system libraries. Without these, an
      # interactive prompt (commonly needrestart's "which services to
      # restart" dialog, which has its own known history of ignoring
      # DEBIAN_FRONTEND=noninteractive in its apt post-invoke hook) can hang
      # indefinitely with no TTY to answer it — confirmed live, not
      # theoretical (see this job's timeout-minutes comment above).
      - name: Install Playwright Chromium
        working-directory: apps/web
        env:
          DEBIAN_FRONTEND: noninteractive
          NEEDRESTART_MODE: a
        run: npx playwright install --with-deps chromium

      # Cheap compile/broken-story smoke first — catches a decorator or
      # import error fast, before paying for the full browser test run.
      - name: Build Storybook
        working-directory: apps/web
        run: pnpm build-storybook

      # The actual gate: every story as a Vitest test (smoke render + any
      # play function), with addon-a11y's checks running inside the same
      # run via parameters.a11y.test: 'error' (.storybook/preview.tsx).
      - name: Run Storybook a11y/interaction tests
        working-directory: apps/web
        run: pnpm test:storybook
  # amcore:sentinel-block end=storybook-job
`

const DEPENDENCY_REVIEW_BLOCK = `          # amcore:sentinel-block start=storybook-allowlist
          # Temporary, narrow exception — not a gate bypass. Both advisories
          # are \`image-size@2.0.2\`, pulled in transitively via
          # \`@storybook/nextjs-vite\` -> \`vite-plugin-storybook-nextjs\`
          # (\`apps/web\` devDependency only). Neither has a fixed version
          # upstream as of 2026-08-15 (\`vulnerable_version_range: <= 2.0.2\`,
          # \`first_patched_version: null\` on both advisories — every
          # published \`image-size\` release is affected, so bumping cannot
          # fix this). Risk here is low, not zero: this dependency never
          # reaches \`apps/web\`'s production build (\`next build\`,
          # \`output: 'standalone'\`, no Storybook code in that path) or an
          # untrusted-input path — Storybook's \`next/image\` decorator only
          # ever parses this repo's own static assets under
          # \`apps/web/public\`. Remove this allowlist entry the moment either
          # advisory gets a patched version or the dependency chain changes —
          # re-check with \`gh api /advisories/<id>\` on any
          # storybook/@storybook/nextjs-vite/vite-plugin-storybook-nextjs/
          # image-size version bump. Tracked in the maintainer backlog; see
          # \`docs/operations/ci-security.md\` for the general policy this
          # follows.
          allow-ghsas: GHSA-5p2g-fcmc-qvqq, GHSA-w3rx-r6r6-pgpr
          # amcore:sentinel-block end=storybook-allowlist
`

export function buildStorybookCiSteps(root) {
  return [
    fileStep(
      path.join(root, '.github/workflows/ci.yml'),
      (content) => removeExactBlock(content, CI_JOB_BLOCK),
      'ci.yml: remove the storybook job'
    ),
    fileStep(
      path.join(root, '.github/workflows/dependency-review.yml'),
      (content) => removeExactBlock(content, DEPENDENCY_REVIEW_BLOCK),
      'dependency-review.yml: remove the Storybook-only advisory allowlist'
    ),
  ]
}
