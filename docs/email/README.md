# Email

AMCore ships reusable email infrastructure for downstream products. The email
layer renders React Email templates, sends through the active provider
(Resend/mock), and protects secret-bearing links from BullMQ, Redis, Bull Board,
and logs.

## What Is Included

| Area      | Built-in behavior                                                                         |
| --------- | ----------------------------------------------------------------------------------------- |
| Templates | React Email + FormatJS messages: English source, Russian translation, shared locale types |
| Delivery  | Direct secret sends, queued non-secret jobs, notification-channel adapter                 |
| Provider  | `EmailProvider` interface with Resend production and mock dev/test drivers                |
| Safety    | Compile-time and runtime guards that prevent secret templates from entering the queue     |
| Tests     | Unit, schema, processor, render integration, and secret-boundary e2e coverage             |

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
| `welcome`            | Queueable, non-secret; best-effort, no resend      |
| `password-reset`     | Secret-bearing direct (`resetUrl`)                 |
| `email-verification` | Secret-bearing direct (`verificationUrl`)          |
| `org-invite`         | Secret-bearing direct (`acceptUrl`)                |
| `notification`       | Notification-channel template, not the email queue |

Organization invitation emails display the complete role names captured at
issuance (for example `MEMBER, Analyst`). The localized CTA points to the original
invitation ingress; sending is best-effort after the database decision commits.
A 202 acknowledgment is not delivery proof. Disable provider link tracking and
redact initial query tokens in ingress logs; see
[invitation security and operations](../auth/invites.md#security-limits-and-operations).

## Quick Decision Table

| Need                                                        | Use                                            |
| ----------------------------------------------------------- | ---------------------------------------------- |
| In-app feed, preferences, mandatory channels, retry history | `NotificationsService.notify()` / `notifyTx()` |
| Non-secret transactional email with bounded recovery        | `EmailService.queue()`                         |
| Email with a token URL or other secret payload              | `EmailService.sendNow()`                       |
| Worker adapter with already-rendered safe content           | `EmailService.send()`                          |

New product emails are not queueable by default. Classify each email before
adding code.

## Check that the provider accepts mail

A `SUPER_ADMIN` can send one fixed test message to their own verified address from the
Console [Integrations](../operations-console/integrations.md#send-a-test-email) page. The
message carries no link and no user content. A successful result means the provider
accepted a direct send from the API server. It does not prove inbox delivery, and it does
not exercise the queue, the worker or the invitation templates. A timeout or a reported
provider limit is shown as unknown, never as "not sent". The result is stored in Redis
(attempt 24 hours, latest result 7 days) and is hidden when the provider, key or sender
changes. The Console shows only closed codes, never the provider's own error text.

## Guides

- [Templates](./templates.md) — add React Email templates, data types, subjects, i18n, and tests.
- [Delivery](./delivery.md) — choose a delivery path and [verify deployed direct/queued mail](./delivery.md#verify-delivery-on-a-deployed-stack).
- [Queued safety and recovery](./queued-safety.md) — immutable request, certainty, finite starts, cooldown/horizon, legacy handling and protected evidence.
- [Security](./security.md) — secret-link invariants, logging rules, and queue boundaries.

## See Also

- Notifications guide — [`docs/notifications/`](../notifications/README.md)
- Auth email flows — [`docs/auth/email-auth.md`](../auth/email-auth.md)
- Organization invites — [`docs/auth/invites.md`](../auth/invites.md)
- Email source — [`apps/api/src/infrastructure/email/`](../../apps/api/src/infrastructure/email/)

Welcome unknown results stop automatic recovery, including current Resend429 results.
See [queued safety](queued-safety.md) and the [offline policy upgrade](queued-upgrade.md).
Direct-secret and notification delivery retain their separate recovery contracts.
