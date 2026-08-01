import { defineRouting } from 'next-intl/routing'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@amcore/shared'

/**
 * Locale routing contract for the web app.
 *
 * The locale set and the default are **not** declared here — they come from
 * `@amcore/shared`, the same source the API uses for `User.locale`,
 * `Accept-Language` negotiation, and email rendering. Adding a locale is a
 * single edit in `SUPPORTED_LOCALES` plus a message catalogue; the frontend
 * must never disagree with the backend about which locales exist.
 *
 * `localePrefix: 'always'` — every locale is explicit (`/en/login`,
 * `/ru/login`). **Do not change this to `'as-needed'`.** It looks like the
 * nicer option (base locale at `/login`) and it is what this project first
 * used, but it is broken in production:
 *
 * `'as-needed'` requires the proxy to *rewrite* `/login` → `/en/login`
 * internally, and Next's standalone server — which is what AMCore's Docker
 * image runs (`output: 'standalone'`) — does not consume the resulting
 * `x-middleware-rewrite` header. It forwards it to the client together with a
 * 307 to the original path, so `/login` redirects to itself forever. Verified
 * here: identical build, `next start` serves `/login` with 200 while the
 * standalone server loops. Upstream: vercel/next.js#91844 (affects every
 * `NextResponse.rewrite()` in a proxy on standalone, not just next-intl; closed
 * without a fix for want of a reproduction).
 *
 * `'always'` sidesteps it because every locale is reached by a *redirect*,
 * which standalone handles correctly — no internal rewrite is ever needed.
 * The cost is that the base locale also carries a prefix. Re-evaluate only
 * once #91844 is genuinely fixed, and re-test against the standalone server,
 * never `next start`.
 *
 * next-intl's proxy already resolves URL prefix → `NEXT_LOCALE` cookie →
 * `Accept-Language` → `defaultLocale`. The one step it cannot know about is an
 * authenticated user's stored `User.locale`, which is applied at the
 * post-login redirect instead — see `useLogin`. Deliberately *not* enforced
 * mid-session: an explicit URL prefix must win for the request it is on, or a
 * user who follows a `/ru/...` link would be bounced back and forth.
 */
export const routing = defineRouting({
  locales: SUPPORTED_LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'always',
})
