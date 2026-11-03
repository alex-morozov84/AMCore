import { z } from 'zod'

import localeConfig from '../config/locales.json'

/**
 * Locales that have a complete message catalogue in the repository. Adding a locale to
 * the product means adding its catalogue (and an entry here); *enabling* it for a build
 * is a separate step in `config/locales.json`. The two lists differ when a build serves
 * fewer languages than the repository can: only the enabled ones are routed, accepted
 * as input, negotiated and offered to users.
 */
export const LOCALE_CATALOGUES = ['en', 'ru'] as const

export type CatalogueLocale = (typeof LOCALE_CATALOGUES)[number]

const catalogueSchema = z.enum(LOCALE_CATALOGUES)

/**
 * Shape of `config/locales.json`. Language-agnostic by design: no literal messages
 * (a schema-level message would outrank the frontend's per-parse error map). The
 * refinement reports a stable code through `params.errorCode`.
 */
export const localeSettingsSchema = z
  .object({
    version: z.literal(1),
    enabled: z.array(catalogueSchema).min(1),
    default: catalogueSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.enabled).size !== value.enabled.length) {
      ctx.addIssue({ code: 'custom', path: ['enabled'], params: { errorCode: 'LOCALE_DUPLICATE' } })
    }
    if (!value.enabled.includes(value.default)) {
      ctx.addIssue({
        code: 'custom',
        path: ['default'],
        params: { errorCode: 'LOCALE_DEFAULT_NOT_ENABLED' },
      })
    }
  })

export type LocaleSettings = z.infer<typeof localeSettingsSchema>

type NonEmptyLocales = readonly [CatalogueLocale, ...CatalogueLocale[]]

const parsed = localeSettingsSchema.safeParse(localeConfig)
if (!parsed.success) {
  // Build-time failure with the offending path; the file is the only place to fix it.
  throw new Error(
    `Invalid packages/shared/src/config/locales.json: ${parsed.error.issues
      .map(
        (issue) =>
          `${issue.path.join('.')} (${(issue as { params?: { errorCode?: string } }).params?.errorCode ?? issue.code})`
      )
      .join(', ')}`
  )
}

/**
 * The locales this build serves, in the order of the settings file. Every locale
 * contract (registration input, profile update, user response, email rendering,
 * routing, negotiation) derives from this list. Nothing should depend on the order —
 * `negotiateLocale` deliberately refuses to negotiate an absent `Accept-Language`
 * header so the result is never coupled to the first entry.
 */
export const SERVED_LOCALES: NonEmptyLocales = parsed.data.enabled as unknown as NonEmptyLocales

/** The locale used when nothing else decides. It is always one of `SERVED_LOCALES`. */
export const DEFAULT_LOCALE: CatalogueLocale = parsed.data.default

/** Why a stored locale string was or was not used as is (see {@link classifyStoredLocale}). */
export type StoredLocaleState = 'enabled' | 'disabled' | 'absent' | 'unknown'

/**
 * Classify a stored locale value (for example `User.locale`): `enabled` is used as is;
 * `disabled` is a known catalogue locale that this build does not serve (expected after a
 * settings change); `absent` is a missing preference (normal); `unknown` is not a
 * catalogue locale at all (a data anomaly worth one structured warning, without the raw
 * value).
 */
export function classifyStoredLocale(value: string | null | undefined): StoredLocaleState {
  if (value === null || value === undefined || value === '') return 'absent'
  const known = catalogueSchema.safeParse(value)
  if (!known.success) return 'unknown'
  return (SERVED_LOCALES as readonly string[]).includes(known.data) ? 'enabled' : 'disabled'
}
