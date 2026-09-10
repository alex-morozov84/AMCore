// Builds the full init:project --mode=single plan (ADR-071): every slice
// from PR3A/PR3B in the one order that keeps the tree consistent at every
// step — buildWebLocaleDirCleanupSteps MUST run last, since every apps/web
// step before it is still reading from or moving files out of [locale]/.
import { buildContextSteps } from './project-plan-context.mjs'
import { buildSharedLocaleSteps } from './project-plan-shared.mjs'
import {
  buildWebStructureSteps,
  buildWebLocaleDirCleanupSteps,
} from './project-plan-web-structure.mjs'
import { buildWebConfigSteps } from './project-plan-web-config.mjs'
import { buildWebGlobalTypesSteps } from './project-plan-web-global-types.mjs'
import { buildWebMessagesSteps } from './project-plan-web-messages.mjs'
import { buildWebMessagesTestSteps } from './project-plan-web-messages-test.mjs'
import { buildWebI18nFixturesSteps } from './project-plan-web-i18n-fixtures.mjs'
import { buildWebOAuthAlertTestSteps } from './project-plan-web-oauth-alert-test.mjs'
import { buildWebZodErrorMapTestSteps } from './project-plan-web-zod-error-map-test.mjs'
import { buildWebApiErrorAlertTestSteps } from './project-plan-web-api-error-alert-test.mjs'
import { buildWebPagesSteps } from './project-plan-web-pages.mjs'
import { buildWebNavSteps } from './project-plan-web-nav.mjs'
import { buildApiLocaleSteps } from './project-plan-api.mjs'

export function buildProjectSteps(root, { locale }) {
  return [
    ...buildContextSteps(root, locale),
    ...buildSharedLocaleSteps(root, locale),
    ...buildApiLocaleSteps(root, locale),
    ...buildWebStructureSteps(root),
    ...buildWebConfigSteps(root),
    ...buildWebGlobalTypesSteps(root, locale),
    ...buildWebMessagesSteps(root, locale),
    ...buildWebMessagesTestSteps(root, locale),
    ...buildWebI18nFixturesSteps(root, locale),
    ...buildWebOAuthAlertTestSteps(root, locale),
    ...buildWebZodErrorMapTestSteps(root, locale),
    ...buildWebApiErrorAlertTestSteps(root, locale),
    ...buildWebPagesSteps(root),
    ...buildWebNavSteps(root),
    ...buildWebLocaleDirCleanupSteps(root),
  ]
}
