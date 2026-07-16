# Email

AMCore ships reusable email infrastructure for downstream products. The email
layer renders React Email templates, sends through the active provider
(Resend/mock), and protects secret-bearing links from BullMQ, Redis, Bull Board,
and logs.

## What Is Included

| Area      | Built-in behavior                                                                     |
| --------- | ------------------------------------------------------------------------------------- |
| Templates | React Email + FormatJS messages for RU/EN and shared locale types                     |
| Delivery  | Direct secret sends, queued non-secret jobs, notification-channel adapter             |
| Provider  | `EmailProvider` interface with Resend production and mock dev/test drivers            |
| Safety    | Compile-time and runtime guards that prevent secret templates from entering the queue |
| Tests     | Unit, schema, processor, render integration, and secret-boundary e2e coverage         |

## Mental Model

```text
Product/domain code
  -> NotificationsService       # feed/preferences/durable channel delivery
  -> EmailService.queue()       # explicitly queueable non-secret email
  -> EmailService.sendNow()     # secret-bearing or direct transactional email

Worker/infrastructure adapters
  -> EmailService.send()        # already-rendered safe content + optional idempotency key
```

Use `NotificationsService` when the event belongs in the notification feed,
must respect preferences/mandatory channels, or needs Postgres-owned retry and
attempt history. Use `EmailService` for transactional email infrastructure.

## Current Templates

| Template             | Class                                              |
| -------------------- | -------------------------------------------------- |
| `welcome`            | Queueable, non-secret                              |
| `password-reset`     | Secret-bearing direct (`resetUrl`)                 |
| `email-verification` | Secret-bearing direct (`verificationUrl`)          |
| `org-invite`         | Secret-bearing direct (`acceptUrl`)                |
| `notification`       | Notification-channel template, not the email queue |

## Quick Decision Table

| Need                                                        | Use                                            |
| ----------------------------------------------------------- | ---------------------------------------------- |
| In-app feed, preferences, mandatory channels, retry history | `NotificationsService.notify()` / `notifyTx()` |
| Non-secret transactional email with async retry             | `EmailService.queue()`                         |
| Email with a token URL or other secret payload              | `EmailService.sendNow()`                       |
| Worker adapter with already-rendered safe content           | `EmailService.send()`                          |

New product emails are not queueable by default. Classify each email before
adding code.

## Guides

- [Templates](./templates.md) — add React Email templates, data types, subjects, i18n, and tests.
- [Delivery](./delivery.md) — choose notification, queued, direct, secret-bearing, or worker delivery.
- [Security](./security.md) — secret-link invariants, logging rules, and queue boundaries.

## See Also

- Notifications guide — [`docs/notifications/`](../notifications/README.md)
- Auth email flows — [`docs/auth/email-auth.md`](../auth/email-auth.md)
- Organization invites — [`docs/auth/invites.md`](../auth/invites.md)
- Email source — [`apps/api/src/infrastructure/email/`](../../apps/api/src/infrastructure/email/)
