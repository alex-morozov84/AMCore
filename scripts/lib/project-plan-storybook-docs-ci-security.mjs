// init:project --storybook=disabled: docs/operations/ci-security.md's
// worked example, which points at the allow-ghsas comment this transform's
// CI-removal step deletes.
import path from 'node:path'
import { fileStep, removeExactBlock } from './init-engine.mjs'

const EXAMPLE_PARAGRAPH = `
Current example: \`image-size@2.0.2\` (transitive via
\`@storybook/nextjs-vite\`, Track 8) — see the comment above \`allow-ghsas\` in
\`.github/workflows/dependency-review.yml\`.
`

export function buildStorybookDocsCiSecuritySteps(root) {
  return [
    fileStep(
      path.join(root, 'docs/operations/ci-security.md'),
      (content) => removeExactBlock(content, EXAMPLE_PARAGRAPH),
      'ci-security.md: remove the now-deleted Storybook advisory-allowlist example'
    ),
  ]
}
