// init:project --storybook=disabled: the remaining frontend docs with a
// Storybook mention — architecture-and-conventions.md's "See also" bullet
// and shared-ui-and-shadcn.md's testing-convention paragraph.
import path from 'node:path'
import { fileStep, removeExactBlock, replaceExactBlock } from './init-engine.mjs'

const ARCHITECTURE_BULLET =
  '- [Storybook](./storybook.md) — the component workshop and its own\n' +
  '  accessibility gate, a fifth layer of the testing pyramid above.\n'

const SHARED_UI_TESTING_BEFORE = `Vitest + React Testing Library, matching the existing pattern in
\`button.test.tsx\`/\`skeleton.test.tsx\`/\`dialog.test.tsx\`: render the
component, assert on \`data-slot\`/\`data-variant\` attributes and behavior
(click, open/close, variant switching), not implementation detail. Every
primitive in the inventory above also has a Storybook story — see
[Storybook](./storybook.md) for story conventions and the CLI-safety
procedure that page's own section mirrors from this one. Adding or changing a
\`shared/ui\` primitive means adding or updating its co-located \`*.stories.tsx\`
file in the same PR; \`test:storybook\` is a CI gate in strict upstream mode.
`

const SHARED_UI_TESTING_AFTER = `Vitest + React Testing Library, matching the existing pattern in
\`button.test.tsx\`/\`skeleton.test.tsx\`/\`dialog.test.tsx\`: render the
component, assert on \`data-slot\`/\`data-variant\` attributes and behavior
(click, open/close, variant switching), not implementation detail.
`

export function buildStorybookDocsMiscSteps(root) {
  return [
    fileStep(
      path.join(root, 'docs/frontend/architecture-and-conventions.md'),
      (content) => removeExactBlock(content, ARCHITECTURE_BULLET),
      'architecture-and-conventions.md: remove the Storybook "See also" bullet'
    ),
    fileStep(
      path.join(root, 'docs/frontend/shared-ui-and-shadcn.md'),
      (content) => replaceExactBlock(content, SHARED_UI_TESTING_BEFORE, SHARED_UI_TESTING_AFTER),
      'shared-ui-and-shadcn.md: drop the Storybook story convention paragraph'
    ),
  ]
}
