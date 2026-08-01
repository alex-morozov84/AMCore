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
| `apps/web/src/i18n/`                            | Routing config, locale-aware navigation, request config, param guard |
| `apps/web/src/shared/api/`                      | Error-code resolution and the `useApiError` hook                     |
| `apps/api/src/infrastructure/email/messages.ts` | Email copy (separate catalogue — emails render server-side)          |

`packages/shared` owns `SUPPORTED_LOCALES` and `DEFAULT_LOCALE`. Frontend,
backend, and email all derive from it, so they cannot disagree about which
locales exist.

## Recipe: add a UI string

1. Add the key to `messages/en.json`.
2. Add the same key to **every** other catalogue.
3. Use it: `const t = useTranslations('namespace')` → `t('key')`.

Keys are type-checked against `en.json`, so a typo fails `pnpm typecheck`
instead of showing up in the browser. A key present in one catalogue but not
another fails `src/i18n/messages.test.ts`.

Never inline user-facing text in a component, including "temporary" strings and
placeholder copy — an ESLint rule blocks non-ASCII literals, but English
hardcoded text is just as wrong and only review catches it.

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

Step 3 is not optional: `src/shared/api/error-messages.test.ts` derives its
expectations from those enums, so a code without a translation fails the build.
That guard exists because the original contract rotted exactly this way — the
codes were defined, the frontend never translated them, and nothing complained.

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

Any URL the backend puts in front of a user must carry the locale it already
knows, via `localizedFrontendUrl()` from `@amcore/shared`. That covers email
CTAs (verification, password reset, invites), notification links (email and
Telegram), **and the OAuth callback and account-linking redirects**:

```ts
const url = localizedFrontendUrl(this.env.get('FRONTEND_URL'), userLocale, 'verify-email', {
  token,
})
// → https://app.example.com/ru/verify-email?token=…
```

An unprefixed link would be resolved by cookie or `Accept-Language`, and these
links cannot rely on either. An emailed link may be opened in a browser that has
never visited the app; an OAuth callback lands in a browser mid-sign-in that has
no locale cookie yet. A Russian user would get an English page in both cases.

When adding a test for such a link, assert the **specific** locale, not just
that some prefix is present — a `/(en|ru)/` pattern passes against a hardcoded
`/en`.

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

## Recipe: add a third locale

1. Add it to `SUPPORTED_LOCALES` in `packages/shared/src/constants/index.ts`.
2. Copy `messages/en.json` to `messages/<locale>.json` and translate it. Keep
   every key; add the CLDR plural categories that language requires.
3. Add a message block for it in `apps/api/src/infrastructure/email/messages.ts`.
4. Add the locale's display name under `locale.<code>` in every catalogue.
5. Run `pnpm --filter @amcore/web test:run` and `pnpm --filter api test` — the
   parity and coverage guards will name anything missing.

No routing change is needed: routes, the switcher, and `generateStaticParams`
all read `SUPPORTED_LOCALES`.

Consider whether the backend should keep accepting the new locale from
`Accept-Language` before shipping — `negotiateLocale` restricts itself to
`SUPPORTED_LOCALES`, so it starts negotiating the new locale immediately.

## Downstream: running a single-locale app

A fork that only ever needs one language should **remove** the locale routing
rather than configure it away:

1. Move everything from `src/app/[locale]/` up into `src/app/`.
2. Delete `src/proxy.ts`, `src/i18n/routing.ts`, `src/i18n/navigation.ts`, and
   `src/i18n/params.ts`; import `Link` and navigation hooks from `next/link` and
   `next/navigation` again, and drop the ESLint rule that blocks them.
3. Return a static locale from `src/i18n/request.ts` — next-intl's
   ["without i18n routing"](https://next-intl.dev/docs/getting-started/app-router/without-i18n-routing)
   setup.
4. Remove `LocaleSwitcher` and its `PATCH /auth/me` persistence.
5. Keep one catalogue. Trim `SUPPORTED_LOCALES` to that locale so the backend,
   emails, and notifications agree.

**Do not instead set `localePrefix: 'never'`.** It looks like the obvious way to
get unprefixed URLs, and it is a trap: next-intl implements `'never'` by
rewriting every request to add the locale internally, and Next's standalone
server — what the Docker image runs — does not apply proxy rewrites
([vercel/next.js#91844](https://github.com/vercel/next.js/issues/91844)). Every
page would redirect to itself forever in production while working fine under
`next dev` and `next start`. The same defect is why upstream AMCore uses
`localePrefix: 'always'`.

## What the guards catch

| Guard                                        | Catches                                                                      |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm typecheck`                             | A translation key that does not exist in `en.json`                           |
| `src/i18n/messages.test.ts`                  | Catalogues out of sync, empty values, missing plural categories              |
| `src/shared/api/error-messages.test.ts`      | A shared error code with no translation, or an orphaned message              |
| `apps/api/.../messages.spec.ts`              | The same, for email copy                                                     |
| `apps/api/.../frontend-url-coverage.spec.ts` | A backend module building a link from `FRONTEND_URL` without a locale prefix |
| ESLint                                       | Non-ASCII literals in code, locale-unaware navigation, `z.config`            |

None of them can tell you a translation is _wrong_ — only that it is missing.
Reviewing the actual wording is still a human job.
