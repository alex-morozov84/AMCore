import { z } from 'zod'

import adminConsoleConfig from '../config/admin-console.json'

import { LOCALE_CATALOGUES } from './locales'

/**
 * Path segments a Console alias must never take: the API and Next internals, and every
 * locale code (a locale folder would collide with the Console folder).
 */
const RESERVED_ALIASES: readonly string[] = ['api', '_next', '_vercel', ...LOCALE_CATALOGUES]

/**
 * Shape of `config/admin-console.json`. The same alias rule as the product administration
 * area (`product-admin.json`): a lowercase single segment that is also the name of the
 * physical folder `apps/web/src/app/[locale]/<alias>`. Language-agnostic: no literal
 * messages; the refinement reports a stable code through `params.errorCode`.
 */
export const adminConsoleSettingsSchema = z
  .object({
    version: z.literal(1),
    mode: z.enum(['disabled', 'path', 'host']),
    alias: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (RESERVED_ALIASES.includes(value.alias)) {
      ctx.addIssue({ code: 'custom', path: ['alias'], params: { errorCode: 'ALIAS_RESERVED' } })
    }
  })

export type AdminConsoleSettings = z.infer<typeof adminConsoleSettingsSchema>
export type AdminConsoleMode = AdminConsoleSettings['mode']

const parsed = adminConsoleSettingsSchema.safeParse(adminConsoleConfig)
if (!parsed.success) {
  // Build-time failure with the offending path; the file is the only place to fix it.
  throw new Error(
    `Invalid packages/shared/src/config/admin-console.json: ${parsed.error.issues
      .map(
        (issue) =>
          `${issue.path.join('.')} (${(issue as { params?: { errorCode?: string } }).params?.errorCode ?? issue.code})`
      )
      .join(', ')}`
  )
}

/**
 * How this build serves the Operations Console: `disabled` (no Console pages or BFF),
 * `path` (on the product host under `/<alias>`) or `host` (on its own host). Only the web app
 * reads it; changing the file means rebuilding shared and web (docs/operations-console/configuration.md).
 */
export const ADMIN_CONSOLE_SETTINGS: Readonly<AdminConsoleSettings> = Object.freeze(parsed.data)
