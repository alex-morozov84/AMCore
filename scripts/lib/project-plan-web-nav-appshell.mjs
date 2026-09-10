// init:project --mode=single: AppShell.tsx loses its <LocaleSwitcher />
// render (plus the import). It used to also swap the Link import the same
// way project-plan-web-nav-links.mjs did, but AppShell now imports
// `RouteProgressLink` from `@/shared/ui/route-progress-link` (P1 item 8's
// reconverged FINAL PLAN item 5) -- a path-stable wrapper whose *own*
// single-locale swap lives in project-plan-web-nav-route-progress-link.mjs,
// so this call site needs no edit of its own anymore, same reasoning as
// use-logout.ts/primary-unavailable-fallback.tsx dropping out of
// project-plan-web-nav.mjs once use-route-progress-router.ts absorbed
// their concern.
import path from 'node:path'
import { fileStep, replaceExactBlock } from './init-engine.mjs'

const LOCALE_SWITCHER_IMPORT = "import { LocaleSwitcher } from '@/features/locale-switcher'\n"
const LOCALE_SWITCHER_RENDER = '            <LocaleSwitcher />\n'

function appShellTransform(content) {
  const next = replaceExactBlock(content, LOCALE_SWITCHER_IMPORT, '')
  return replaceExactBlock(next, LOCALE_SWITCHER_RENDER, '')
}

export function buildWebNavAppShellSteps(root) {
  const rel = 'apps/web/src/widgets/app-shell/ui/AppShell.tsx'
  return [
    fileStep(
      path.join(root, rel),
      appShellTransform,
      `${rel}: remove LocaleSwitcher, swap the Link import`
    ),
  ]
}
