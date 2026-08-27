// Aggregates every move-and-rewrite step for init:project --mode=single:
// the six auth pages (split across -1/-2/-3.mjs by shared boilerplate
// shape), the root layout, the (auth) layout, and the OAuth callback route.
import { buildWebPagesSlice1Steps } from './project-plan-web-pages-1.mjs'
import { buildWebPagesSlice2Steps } from './project-plan-web-pages-2.mjs'
import { buildWebPagesSlice3Steps } from './project-plan-web-pages-3.mjs'
import { buildWebRootLayoutSteps } from './project-plan-web-root-layout.mjs'
import { buildWebLayoutSteps } from './project-plan-web-layout.mjs'

export function buildWebPagesSteps(root) {
  return [
    ...buildWebRootLayoutSteps(root),
    ...buildWebLayoutSteps(root),
    ...buildWebPagesSlice1Steps(root),
    ...buildWebPagesSlice2Steps(root),
    ...buildWebPagesSlice3Steps(root),
  ]
}
