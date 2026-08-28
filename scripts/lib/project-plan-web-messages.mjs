// init:project --mode=single: delete the message catalogue for every locale
// except the one kept. Found via the real `pnpm --filter web build` in
// init-project.test.mjs — the "Downstream: running a single-locale app"
// doc's step 5 ("keep one catalogue") was never wired up as a step. The test
// file that compares catalogues for parity is a separate, larger rewrite —
// see project-plan-web-messages-test.mjs.
import path from 'node:path'
import { deleteFileStep } from './init-engine.mjs'

const OTHER_LOCALE = { en: 'ru', ru: 'en' }

export function buildWebMessagesSteps(root, locale) {
  const otherLocale = OTHER_LOCALE[locale]
  return [
    deleteFileStep(
      path.join(root, `apps/web/messages/${otherLocale}.json`),
      `delete the ${otherLocale} message catalogue (single-locale mode keeps only ${locale})`
    ),
  ]
}
