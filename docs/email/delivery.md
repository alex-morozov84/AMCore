# Email Delivery

Choose the delivery path before writing code. This is the main decision point
for downstream product emails.

## Product Decision Tree

1. If the event should appear in the notification feed, respect preferences, or
   keep delivery attempts, add/extend a notification definition and call
   `NotificationsService`.
2. If the email carries a live token URL, magic link, invite link, billing portal
   token, or similar secret, add a direct template and send it with
   `EmailService.sendNow()`.
3. If it is a non-secret transactional email that should retry in the
   background, add a queueable template, Zod schema, queue allowlist entry, and
   call `EmailService.queue()`.
4. If a worker already owns safe rendered content, call `EmailService.send()`
   directly from that adapter and pass an idempotency key derived from the
   durable worker entity.

Examples:

- Report ready and visible in the app: notification definition plus
  `NotificationsService`.
- Product onboarding tip: queueable only if async retry is desired.
- Password reset, invite, magic link: `sendNow()`, never queue.

## Queued Email

Queued email is only for explicitly queueable, non-secret templates:

```text
EmailService.queue()
  -> BullMQ EMAIL / SEND_EMAIL job
  -> EmailProcessor
  -> renderTemplate()
  -> send()
  -> EmailProvider
```

Queued jobs are runtime-validated with Zod after Redis deserialization, use
provider idempotency keys derived from the BullMQ job id, retry transient
provider failures, and dead-letter deterministic failures without logging
payload values.

## Direct Secret Email

Secret-bearing email is direct and in-process:

```text
EmailService.sendNow()
  -> renderTemplate()
  -> send()
  -> EmailProvider
```

This path has no BullMQ job, no Redis payload, no Bull Board visibility, no
queue retry, and no queue durability. The caller owns the immediate failure
semantics.

## Notification Email Channel

Notification email is not the email queue. The notifications subsystem stores
the notification and delivery attempts in Postgres. Its worker claims a
delivery, applies the definition's content policy, renders the generic
`notification` email template, and calls `EmailService.send()` with:

- a verified recipient email only;
- safe title/body projection from the definition;
- provider idempotency key `notification-delivery:<deliveryId>`.

`SECRET` notification content is rejected at definition registration. Secret
token emails stay in direct email paths.

## Provider Contract

Providers implement `EmailProvider.send(params)` from `email.types.ts`.

Provider responsibilities:

- accept rendered `html`, optional `text`, `subject`, recipient metadata, and
  optional `idempotencyKey`;
- return `success`, provider `id`, optional `error`, and optional `retryable`;
- classify deterministic provider/config/payload failures as
  `retryable: false`;
- never log rendered HTML, plaintext bodies, raw payloads, or token URLs.

`ResendEmailProvider` performs real delivery. `MockEmailProvider` is for
development/tests and logs metadata only.
