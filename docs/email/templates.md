# Email Templates

This guide describes the current extension contract for adding infrastructure
email templates. AMCore uses an explicit enum, data union, Zod queue schema, and
render switch. Keep them in sync.

## Add a Template

1. Add the payload type in `apps/api/src/infrastructure/email/email.types.ts`.
2. Add an `EmailTemplate` enum value.
3. Add localized messages in `apps/api/src/infrastructure/email/messages.ts` for
   every supported locale.
4. Add a React Email component under
   `apps/api/src/infrastructure/email/templates/`. Import the JSX primitives
   (`Body`, `Button`, `Container`, `Head`, `Heading`, `Hr`, `Html`, `Preview`,
   `Section`, `Text`) from `../react-email`, not `@react-email/components` —
   see `apps/api/src/infrastructure/email/react-email/NOTICE.md` for why
   these are vendored. If a template needs a primitive outside that set
   (`Row`/`Column`, `Img`, `Link`, `Markdown`, `Tailwind`, `Font`,
   `CodeBlock`), that's a new decision, not a drop-in addition — read the
   NOTICE first before reaching for the `react-email` package.
5. Add a localized subject helper beside the template.
6. Wire `EmailService.renderTemplate()` to the component and subject helper.
7. Add the payload type to `RenderableEmailData`.
8. If the template is queueable, add a Zod schema in `email.schema.ts`, add it
   to the discriminated union, and add the template to
   `QUEUEABLE_EMAIL_TEMPLATES`.
9. Add an `EmailService` helper only for a stable app-level use case.

Do not add a template to the queue schema just because it is an email. Queueing
is an explicit delivery classification.

## i18n and Subjects

Infrastructure templates use FormatJS messages from `messages.ts` and the shared
locale set from `@amcore/shared`. Subjects live beside each template as
`get...Subject(locale)` helpers.

Rules:

- Add every message key for every supported locale.
- **Keep user-facing copy in message catalogs, not service methods** — including
  units. Pass a _number_ (`expiresInHours`) and let the catalogue phrase it;
  building `${hours} часов` in a service hardcodes one language into every
  recipient's email, which is a defect this starter already shipped once.
- **Pluralize with ICU in the message**, never a helper in code:
  `{hours, plural, one {# час} few {# часа} many {# часов} other {# часа}}`.
  Russian needs four CLDR categories; supplying only `one`/`other` renders with
  wrong grammar and is invisible when testing in English. `messages.spec.ts`
  enforces the required categories.
- **Build links with `localizedFrontendUrl()`** from `@amcore/shared`, never by
  concatenating `FRONTEND_URL`. Web routes are locale-prefixed, and an emailed
  link cannot fall back to a browser cookie the recipient may not have. A test
  (`frontend-url-coverage.spec.ts`) fails any `FRONTEND_URL` read outside that
  helper. Full rules: [`docs/frontend/i18n-and-errors.md`](../frontend/i18n-and-errors.md).
- Render HTML and plaintext from the same React Email component.
- Notification definitions own their own copy and content policy; they do not
  need to use the infrastructure email message catalog.

## Required Tests

When adding or changing templates, update tests in the same PR:

- `messages.spec.ts` for locale/message key parity **and required CLDR plural
  categories**.
- `email.schema.spec.ts` for queue schema changes.
- `email.service.spec.ts` for render/queue/direct behavior.
- `processors/email.processor.spec.ts` for worker semantics.
- `templates/*.integration.spec.ts` for real React Email render in supported
  locales, HTML, plaintext, and template-specific assertions.
- `apps/api/test/email-secrets.e2e-spec.ts` when touching secret boundaries.
- Notification specs when using `NotificationsService` or changing definitions.

## Registry Follow-Up

A typed template registry may replace the explicit switch/union model later.
Until that happens, downstream products should follow the current enum + union +
schema + render-switch contract.
