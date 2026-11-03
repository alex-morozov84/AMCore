# i18n and error localization

How `apps/web` decides which language to show, where copy lives, and how server
failures become text a user can act on.

The short version: **English is the base locale, Russian ships as a full second
locale, and nothing user-facing is ever written in a component.**

Architecture-level rules (routing, navigation imports, `setRequestLocale`) live
in [Architecture & conventions](./architecture-and-conventions.md#locale-routing).
This page is the working guide.

## Where things live

| Path                                            | Holds                                                                |
| ----------------------------------------------- | -------------------------------------------------------------------- |
| `apps/web/messages/en.json`                     | **Source of truth.** Every key starts here                           |
| `apps/web/messages/ru.json`                     | Full translation — same keys, no more, no fewer                      |
| `packages/shared/src/config/locales.json`       | **Which locales this build serves** and the default one              |
| `apps/web/src/i18n/`                            | Routing config, locale-aware navigation, request config, param guard |
| `apps/web/src/shared/api/`                      | Error-code resolution and the `useApiError` hook                     |
| `apps/api/src/infrastructure/email/messages.ts` | Email copy (separate catalogue — emails render server-side)          |

`packages/shared` owns `SUPPORTED_LOCALES` and `DEFAULT_LOCALE`, read from
`locales.json`. `SUPPORTED_LOCALES` means the locales **this build serves**. The
translated catalogues the repository contains are a separate list,
`LOCALE_CATALOGUES`. Frontend, backend, and email derive their served locales from this file. Deploy matching
builds together; an old API or worker image still carries its old settings.

## Recipe: add a UI string

1. Add the key to `messages/en.json`.
2. Add the same key to **every** other catalogue.
3. Use it: `const t = useTranslations('namespace')` → `t('key')`.

Keys are type-checked against `en.json`, so a typo fails `pnpm typecheck`
instead of showing up in the browser. A key present in one catalogue but not
another fails `src/i18n/messages.test.ts`.

A key must not contain `.`: next-intl reads it as nesting and reports
`INVALID_KEY` on every render. When a key is a data code that contains dots,
such as an audit action, store it with `_` instead and convert the code when you
look it up.

### Which messages reach the browser

Server Components read the complete catalogue through `getTranslations`. The browser
receives only the namespaces selected by server composition. The locale root selects
`common`, `errors`, `validation` and `locale`. Shells and sections add their own namespaces.
Matching top-level catalogue keys automatically define `MessageNamespace` through
the existing message type augmentation. There is no separate namespace registry or
denylist to update. A new namespace still needs selection at its section boundary.

```text
Server catalogue -> root core -> section additions -> client context
```

To add client translations to a new section:

1. Add matching keys to every catalogue.
2. Wrap the section composition with `ClientMessages` from
   `@/i18n/client-message-boundary`. Pass a nonempty literal list or local constant tuple.
   Inline the tuple when local bindings are ambiguous or shadowed.
3. Select only additions to the parent. A page within an existing section inherits its
   namespaces; do not select them again. Wrap shared shells, slots and failure branches too.
4. Verify the rendered section and navigation from another section in both languages.
   A page boundary does not cover its sibling `loading.tsx` or `error.tsx`.

Find the owning composition under `src/_app/<slice>` and its outer route/layout.
Search their `ClientMessages` calls to see inherited selections. For example,
`src/_app/organization-access/ui/frame.tsx` owns the product shell's additions;
`src/_app/auth/index.tsx` owns ordinary authentication pages.

```tsx
import type { ReactNode } from 'react'
import { ClientMessages } from '@/i18n/client-message-boundary'

export function Section({ children }: { children: ReactNode }) {
  return <ClientMessages namespaces={['auth']}>{children}</ClientMessages>
}
```

Use this example only when the parent has not already selected `auth`.
The private adapter preserves the parent locale and merges disjoint additions.
Empty, repeated, unknown or parent-overlapping selections fail explicitly. If a known
namespace was never selected, next-intl reports `MISSING_MESSAGE`; add it at the owning
section boundary. Do not hide that error by loading the full catalogue.

Runtime catalogue imports belong only in `src/i18n/request.ts`. Production code must
not access `NextIntlClientProvider`, `IntlProvider` or `useMessages` directly. The paired
lint policy checks named imports, aliases, reexports and static dynamic imports from
`next-intl`, `use-intl` and `use-intl/react`. Namespace imports and dynamic loads from
those entries are rejected outside the private boundary. Test/Storybook fixtures and
erased type-only imports remain legal. Computed module names and reflected access still
require review; lint is not a complete module graph analyser.

Never inline user-facing text in a component, including "temporary" strings and
placeholder copy — an ESLint rule blocks non-ASCII literals, but English
hardcoded text is just as wrong and only review catches it.

### Language selection

Multi-locale builds use one native select with an accessible name. Selection changes
language immediately. The control shows the requested language and disables selection
while navigation is pending. URL-backed state remains in the path, repeated query and
current fragment. Unsaved local form fields can reset when the locale subtree remounts.

Admitted product pages also save the profile preference on a best-effort basis; a failed
save does not block navigation. Authentication frames and the Operations Console only
change the URL and locale cookie. They add no product-profile requests. Existing feature
reads, such as email-verification status deciding its next page, retain their own contract.
See the [temporary Next route-cache patch](next-route-cache-patch.md) for the production
fragment regression and dependency maintenance.

### Plurals

Use ICU plural syntax **in the message**, never a helper in code:

```json
"itemCount": "{count, plural, one {# item} other {# items}}"
```

```json
"itemCount": "{count, plural, one {# элемент} few {# элемента} many {# элементов} other {# элемента}}"
```

Russian needs four CLDR categories (`one`, `few`, `many`, `other`); English
needs two. Supplying only `one`/`other` for Russian still renders — with wrong
grammar for counts like 2 or 5 — and is invisible while testing in English. A
test enforces the required categories per locale.

Do **not** write a `pluralize()` helper. It hardcodes one language's grammar
into code, does not generalise (Arabic has six categories, Japanese one), and
puts grammar somewhere translators cannot reach. ICU plus CLDR is what the
runtime already implements.

### Dates and numbers

Use `useFormatter()` / `getFormatter()` from next-intl, not raw `Intl` — it
keeps server and client rendering consistent. Named formats live in
`src/i18n/request.ts` and are type-checked.

## Recipe: add a backend error code, end to end

1. Add the value to the appropriate enum in
   `packages/shared/src/constants/index.ts`.
2. Throw it from the API with `AppException`.
3. Add `errors.<CODE>` to **every** catalogue in `apps/web/messages/`.

A code that only the web BFF emits (`REGISTRATION_SIGN_IN_REQUIRED`, see
[registration results](api-consumption.md#registration-results-in-the-web-application))
needs the same enum entry and catalogue entries; the BFF builds the response, not the API.

Step 3 is not optional: `src/shared/api/error-messages.test.ts` derives its
expectations from those enums, so a code without a translation fails the required tests.

Render failures with `<ApiErrorAlert error={error} />`, or call `useApiError()`
for `{ code, message, correlationId, isUnknown }`.

**Never render the backend's `message`.** It is English and written for
developers. An unrecognised code falls back to a generic localized message plus
the `correlationId` — that is what support needs to find the request, and it
leaks nothing. In development, an untranslated code also logs a console warning
naming the code.

## Recipe: localize form validation

Build forms with `useLocalizedForm(schema, options)` rather than `useForm` plus
`zodResolver`. It attaches a per-parse Zod error map so messages render in the
active locale.

```tsx
const form = useLocalizedForm<LoginInput>(loginSchema, {
  defaultValues: { email: '', password: '' },
})
```

Two rules follow from Zod's precedence (schema-level → per-parse → global →
locale):

- **Never put a literal `message` in a shared schema.** It outranks the map and
  silently defeats localization for that field. Schemas stay language-neutral;
  a `superRefine` carries `params.errorCode` instead, which resolves through the
  same `errors.*` catalogue as API errors — so a rule enforced on both sides
  reads identically wherever it fires.
- **Never set a global Zod locale** (`z.config(z.locales.*)`). It is
  process-global, cannot be scoped to a request or a render
  ([colinhacks/zod#4986](https://github.com/colinhacks/zod/issues/4986)), and so
  cannot serve two locales; on the server it races across requests. An ESLint
  rule blocks it.

Server-returned field errors are localized by code too — `useFormMutation`
routes them through `useFieldErrorTranslator`, never the wire `message`. That
path is coarser, since the wire format carries no `minimum`/`format`, so treat
it as the backstop with the client schema catching most issues first.

## Links the backend sends

Any URL the backend puts in front of a user must use `localizedFrontendUrl()`
from `@amcore/shared` with the intended locale. The helper follows the build's prefix policy. That covers email
CTAs (verification, password reset, invites), notification links (email and
Telegram), **and the OAuth callback and account-linking redirects**:

```ts
const url = localizedFrontendUrl(this.env.get('FRONTEND_URL'), userLocale, 'verify-email', {
  token,
})
// → https://app.example.com/ru/verify-email?token=…
```

With several served locales, an unprefixed link would be resolved by cookie or
`Accept-Language`, and these
links cannot rely on either. An emailed link may be opened in a browser that has
never visited the app; an OAuth callback lands in a browser mid-sign-in that has
no locale cookie yet. A Russian user would get an English page in both cases.

With one served locale, the helper emits no prefix; the build supplies the language.
Test the exact URL for the configured locale list: the correct prefix with several
locales, and no prefix with one. A `/(en|ru)/` check alone misses a hardcoded `/en`.

The helper lives in `packages/shared` because the prefix strategy is a contract
both apps must agree on — if the frontend changes it, the backend follows from
one place.

A test enforces this rather than leaving it to review, and it checks **each
read**, not each file: the env value must appear _inside_ a
`localizedFrontendUrl(...)` argument list. Do not assign `FRONTEND_URL` to a
variable first — a file-level check would pass a bare link added next to a
correct one, and the files most likely to grow a new link are exactly the ones
that already contain correct ones. `.ts` and `.tsx` are both scanned, since
React Email templates live in `.tsx`.

## Task: choose the served locales

Use this to ship one language (for example Russian only) or to change the default.
The repository stays English and Russian; the file selects what the build serves.

1. Edit `packages/shared/src/config/locales.json`:

   ```json
   { "version": 1, "enabled": ["ru"], "default": "ru" }
   ```

   `enabled` lists served locales (at least one, no duplicates, each one a
   catalogue locale). `default` must be in `enabled`. A wrong file fails the
   build and names the field. The edge generators in step 2 check the file with the same
   rules first and write nothing when it is wrong.

2. Regenerate both sets of edge files from the source settings, before building:

   ```bash
   node scripts/render-product-admin-edge.mjs --write
   node scripts/render-console-edge.mjs --write
   node scripts/check-product-admin-placement.mjs
   ```

   Run both generators even when the Console or product administration uses path mode.
   Product-admin host mappings also depend on the served locales. The web build checks
   both sets and refuses stale files. These commands read source settings, not shared `dist`.

3. Run `pnpm build`. It rebuilds shared, API and web; the worker uses the API build.
   Building web alone against old shared output fails the settings freshness check.
   Follow its instruction to run `pnpm --filter @amcore/shared build`, then retry.
4. Review and commit `locales.json` and every changed generated edge file:
   `docker/caddy/Caddyfile.console-host`, `docker/nginx/operations-console.conf`,
   `docker/caddy/product-admin.generated.caddy`, `docker/nginx/product-admin.generated.conf`
   and `docker/nginx/product-admin-site.generated.conf`.
   Unchanged outputs need no commit. Never commit `dist` or `.next`.

To serve both shipped languages again, write
`{ "version": 1, "enabled": ["en", "ru"], "default": "en" }` and repeat steps 2 to 4. `default`
is your product choice; `en` is the shipped one.

What changes with **one** served locale:

| Area                                                      | Behavior                                                                                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Public URLs                                               | Bare paths: `/login` answers 200, not `/ru/login`                                                                               |
| `/ru/login` for the served locale                         | Redirects (307) to `/login`, query kept                                                                                         |
| A catalogue locale that is not served                     | `/en/login` answers 404                                                                                                         |
| Links sent or saved before the change with the old prefix | Answer 404 when the prefix is no longer served, for example `/en/verify-email?...` in an email; the person requests a new email |
| Links the backend puts in new emails                      | Built without a prefix (`localizedFrontendUrl`)                                                                                 |
| Language switcher                                         | Not shown                                                                                                                       |
| New accounts, emails, notifications                       | Written and rendered in the default locale                                                                                      |
| Accounts created while one locale is served               | Store that locale and keep it when you serve more locales again                                                                 |
| Accounts that stored a locale you stopped serving         | Read as the default locale; the stored value is not rewritten                                                                   |
| Queued mail and saved drafts written under other settings | Still read: any shipped catalogue locale is accepted, then mapped to the default; a message is never half in one language       |
| API input                                                 | Accepts only served locales; any other value is refused by input validation                                                     |

With two or more served locales nothing changes: every URL carries its locale prefix.

Nothing is deleted from the repository. A locale you do not serve keeps its
catalogue file and its email copy; the tests still check them.

**Roll out the change to a running product.** The file is embedded in the shared package, so the
API, the worker and the web app each carry their own copy. Replace all of them with images built
from the same commit, in the order of
[Upgrades](../operations/deployment.md#upgrades-new-migrations-in-a-release) when you build on the
host, or by promoting new image digests as described in
[Registry upgrades](../operations/deployment.md#registry-upgrades). If only the web app
is replaced, it serves one language while the API and the worker still accept and render the old
list. Apply changed Console and product-admin host mappings with their matching application
images; stop affected traffic during a mixed configuration. (The deployment guide's
"keep the existing Caddy running" covers an unchanged proxy file; a changed edge file is applied
together with the images.) After the rollout open
`/login`, check that the removed prefix answers 404, and verify the build identity as described in
[Verify the deployed artifact](../operations/deployment.md#verify-the-deployed-artifact).

For the first deployment, choose and commit these settings before building images, then use
[Single-host deployment](../operations/single-host-compose.md) or the registry startup path
in the deployment guide. Fork identity is a separate step:
[initialize the brand](brand-theme-and-tokens.md#fork-initialization).

**Recovery.** Before rollout, retain the previous settings, generated edge configuration and
image digests. If verification fails, stop the rollout and follow the deployment guide's
rollback procedure with that matching set. Do not restore only web or only the proxy.
With registry images, promote the previous digests together with the previous edge files
([Registry upgrades](../operations/deployment.md#registry-upgrades)). For a source build, check
out the previous commit (settings and generated files), rebuild all consumers,
and repeat the ordered rollout. Changing the locale list does not rewrite stored preferences.
Already prepared or delivered messages are not rewritten by a settings change: a link already
written into one keeps its old prefix and answers 404 when that prefix is no longer served.
Do not retry secret mail blindly; use the appropriate verification or password-reset
flow to request a new link.

## Recipe: add a third locale

1. Add it to `LOCALE_CATALOGUES` in `packages/shared/src/constants/locales.ts`, then to
   `enabled` in `locales.json` (see above).
2. Copy `messages/en.json` to `messages/<locale>.json` and translate it. Keep
   every key; add the CLDR plural categories that language requires.
3. Add a message block for it in `apps/api/src/infrastructure/email/messages.ts`.
4. Add the locale's display name under `locale.<code>` in every catalogue.
5. Run `pnpm --filter web test:run` and `pnpm --filter api test` — the
   parity and coverage guards will name anything missing.

No routing change is needed: routes, the switcher, and `generateStaticParams`
all read the served list. Repeat the edge-generation and build steps in
[Choose the served locales](#task-choose-the-served-locales).

Consider whether the backend should keep accepting the new locale from
`Accept-Language` before shipping — `negotiateLocale` restricts itself to
`SUPPORTED_LOCALES`, so it starts negotiating the new locale immediately.

## Why the middleware keeps `localePrefix: 'always'`

Do not set next-intl's `localePrefix` to `'never'` or `'as-needed'` in `routing.ts`.
Both make next-intl's middleware rewrite every request to add the locale, and Next's
standalone server — what the Docker image runs — does not apply proxy rewrites
([vercel/next.js#91844](https://github.com/vercel/next.js/issues/91844)). Pages would
redirect to themselves forever in production while working under `next dev` and
`next start`.

One served locale still gets bare URLs, without a proxy rewrite:

1. `next.config.ts` declares a `beforeFiles` rewrite from `/<path>` to `/<locale>/<path>`,
   and 307 redirects from `/<locale>` and `/<locale>/<path>`. Next applies config
   rewrites on the standalone server.
2. `src/proxy.ts` skips next-intl's middleware and answers 404 for the prefix of a
   locale that is not served.
3. `src/i18n/navigation.ts` builds links with `'never'`, which needs no middleware.

Re-test any change here against the standalone build (`node server.js`), never only
`next start`.

## What the guards catch

| Guard                                        | Catches                                                                      |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm typecheck`                             | A translation key that does not exist in `en.json`                           |
| `src/i18n/messages.test.ts`                  | Catalogues out of sync, empty values, missing plurals, `.` inside a key      |
| `e2e/mocked/message-payload.spec.ts`         | Unexpected namespaces in serialized client message payloads                  |
| `src/shared/api/error-messages.test.ts`      | A shared error code with no translation, or an orphaned message              |
| `apps/api/.../messages.spec.ts`              | The same, for email copy                                                     |
| `apps/api/.../frontend-url-coverage.spec.ts` | A backend module building a link from `FRONTEND_URL` without a locale prefix |
| Oxlint + ESLint                              | Non-ASCII literals in code, locale-unaware navigation, `z.config`            |

None of them can tell you a translation is _wrong_ — only that it is missing.
Reviewing the actual wording is still a human job.

Frontend email/OAuth destinations also carry the selected site/admin surface.
Continue to build locale-aware URLs through the shared helper; use the configured
public admin path/origin rather than concatenating the physical route prefix. See
[placement and sessions](../product-admin/placement-and-sessions.md).
