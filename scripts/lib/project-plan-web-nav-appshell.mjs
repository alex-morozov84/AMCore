// init:project --mode=single: AppShell.tsx loses its <LocaleSwitcher />
// render (plus the import) and moves the Link import the same way every
// file in project-plan-web-nav-links.mjs does (verified empirically there
// — Link sorts immediately before next-intl's import). Kept separate from
// that file since this one also removes a render call, not just an import.
import path from 'node:path'
import { fileStep, replaceExactBlock } from './init-engine.mjs'

const LOCALE_SWITCHER_IMPORT = "import { LocaleSwitcher } from '@/features/locale-switcher'\n"
const LINK_IMPORT = "import { Link } from '@/i18n/navigation'\n"
const NEXT_INTL_IMPORT = "import { useTranslations } from 'next-intl'\n"
const LOCALE_SWITCHER_RENDER = '            <LocaleSwitcher />\n'

function appShellTransform(content) {
  let next = replaceExactBlock(content, LOCALE_SWITCHER_IMPORT, '')
  next = replaceExactBlock(next, LINK_IMPORT, '')
  next = replaceExactBlock(
    next,
    NEXT_INTL_IMPORT,
    `import Link from 'next/link'\n${NEXT_INTL_IMPORT}`
  )
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
