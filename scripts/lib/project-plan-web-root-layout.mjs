// init:project --mode=single: the root layout. Split from
// project-plan-web-layout.mjs (which now covers (auth)/layout.tsx and the
// OAuth callback route) to stay under the repo's ~150-line-per-file
// guidance -- the before/after text itself lives in
// project-plan-web-root-layout-before.mjs and -after.mjs for the same reason.
import path from 'node:path'
import { moveAndRewriteStep } from './init-engine.mjs'
import { ROOT_LAYOUT_BEFORE } from './project-plan-web-root-layout-before.mjs'
import { ROOT_LAYOUT_AFTER } from './project-plan-web-root-layout-after.mjs'

const LOCALE_APP = 'apps/web/src/app/[locale]'
const APP = 'apps/web/src/app'

export function buildWebRootLayoutSteps(root) {
  return [
    moveAndRewriteStep(
      path.join(root, LOCALE_APP, 'layout.tsx'),
      path.join(root, APP, 'layout.tsx'),
      { expectedBefore: ROOT_LAYOUT_BEFORE, after: ROOT_LAYOUT_AFTER },
      'move and rewrite the root layout for a single static locale'
    ),
  ]
}
