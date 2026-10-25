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
  -> registered managed worker + queued-email policy
  -> validate and freeze the rendered request
  -> PG possible-call reservation + current broker/time fence
  -> byte-preserving queued provider transport
```

Queued jobs are runtime-validated with Zod after Redis deserialization, use
an incarnation-derived provider key and immutable request bytes. Finite retries
must satisfy recorded certainty, cooldown and the original horizon. A recycled
job ID does not renew an old delivery's window. See
[queued safety and recovery](queued-safety.md) for clock assumptions, legacy handling
and independent evidence retention.

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

### Privileged support mail

The privileged support-mail service renders in memory, then calls
`EmailService.sendDirectSecret()` once with the rendered parameters and a
synchronous `beforeTransport` callback. It never queues a link or retries a
provider call. Only adapters declaring `supportsDirectSecretFence` are eligible.
They must prepare request arguments first, call the callback exactly once, then
enter transport immediately without logging or awaiting between them.

The finite result distinguishes validated provider acceptance, non-production
simulation, a call that did not start, and uncertainty. Resend's parsed error
names lack an independent no-effect HTTP witness, so negative responses remain
unknown with a safe reason. An accepted response requires a bounded, valid
provider ID and no contradictory error. It does not prove delivery or completion.
This does not change the public `sendNow()` compatibility contract.

Attempt bindings use SHA-256 to compare the canonical recipient and non-secret
policy metadata. The password-reset setting in that metadata is a numeric link
lifetime, not a password. These fingerprints do not store credentials or replace
Argon2id password hashing. Random mail-token lookup keys follow the
[authentication contract](../auth/email-auth.md#password-reset).

## Notification Email Channel

Notification email is not the email queue. The notifications subsystem stores
the notification and delivery attempts in Postgres. Its worker claims a
delivery, applies the stored definition version's content policy, renders the generic
`notification` template, and freezes the complete provider request under its lease.
It then calls `EmailService.sendPreparedNotification()` with the exact stored body,
provider idempotency key `notification-delivery:<deliveryId>` and live abort signal.

The body includes the verified recipient, sender, subject, HTML, plaintext and any
reply-to value. Retries reuse those bytes and key even after a template or sender
configuration changes. Credentials and abort signals remain live and are never
stored. The private request can contain recipient addresses and rendered content;
keep it out of logs, feed DTOs, Console projections and queue payloads. See
[Versioning and replay](../notifications/versioning.md).

`SECRET` notification content is rejected at definition registration. Secret
token emails stay in direct email paths.

The worker authorizes each send just before it happens (lease still owned, attempt
not timed out) and passes an in-memory abort `signal` in the send parameters so the
attempt's timeout or a shutdown can abort the request. The signal is never
serialized — it is not part of any queue payload or schema — and direct and queued
callers are unaffected. If the provider answers a rate limit with a retry delay
(Resend sends `Retry-After`), the adapter reports it as `retryAfterMs` and the
notification retry schedule will not retry before it (a delay above 24 hours is
clamped to 24 hours; see
[Delivery guarantees](../notifications/README.md#delivery-guarantees-and-operating-limits)).
A provider that reports no delay just uses the ordinary backoff. Capacity is a
per-worker concurrency cap, not a team-wide rate limiter: if your account's request
rate is limited, replicas multiply the cap.

## Provider Contract

Providers implement `EmailProvider.send(params)` and
`EmailProvider.sendPrepared(body, idempotencyKey, signal)` from `email.types.ts`.
Direct email uses `send`; durable notification deliveries use `sendPrepared`.
Queued email additionally requires the closed `queuedEmail` recipe port with
frozen scope, certainty mapping and a synchronous actual-transport fence. The
prepared notification port must send
`body` unchanged with the required `idempotencyKey`, attach credentials at send
time and propagate the live abort signal. Do not parse and re-render its content.
The installed-SDK fake-fetch suite `resend.provider.contract.spec.ts` verifies the
actual body, key, headers and signal; a new provider needs equivalent coverage.

A byte-preserving provider adapter forwards all three prepared inputs to its transport:

```ts
import type { EmailProvider, SendEmailResult } from './email.types'

type PreparedTransport = (
  body: string,
  idempotencyKey: string,
  signal: AbortSignal
) => Promise<SendEmailResult>

function preparedPort(transport: PreparedTransport): Pick<EmailProvider, 'sendPrepared'> {
  return {
    sendPrepared(body, idempotencyKey, signal) {
      return transport(body, idempotencyKey, signal)
    },
  }
}
```

The transport supplies live credentials and maps its response to `SendEmailResult`;
these prepared inputs are mandatory. The optional fields below apply to direct `send`.

Provider responsibilities:

- accept rendered `html`, optional `text`, `subject`, recipient metadata,
  optional `idempotencyKey`, and an optional in-memory abort `signal` (ignore it if
  the transport cannot abort; never serialize it);
- return `success`, provider `id`, optional `error`, optional `retryable`, and — only
  when the transport exposes one — a normalized `retryAfterMs` (a number of
  milliseconds; never headers or error text). `ResendEmailProvider` reads the
  `Retry-After` header (positive whole seconds with at most 10 ASCII digits, or an
  IMF-fixdate). Zero, past dates and unsupported values use ordinary backoff;
- classify deterministic provider/config/payload failures as
  `retryable: false`;
- never log rendered HTML, plaintext bodies, raw payloads, or token URLs.

`ResendEmailProvider` performs real delivery. `MockEmailProvider` is for
development/tests and logs metadata only.

## First-administrator invitation recovery

[Organization provisioning](../product-admin/organization-provisioning.md) commits the organization before direct invitation mail. It records only a safe last-attempt outcome, never a secret body/link in a queue. Provider acknowledgment is not delivery. An unknown send leaves the organization saved; explicit reissue rotates the invitation. Production mock blocks new operator invitation sends before commit, while reads and exact replay remain available. The global mock default and ordinary email APIs are unchanged.

## Verify delivery on a deployed stack

Use a disposable deployment with approved Resend credentials, a verified sender
and a mailbox you control. Set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`
and the public HTTPS `FRONTEND_URL` on both API and worker through the deployment
configuration. Keep secret-link tracking disabled and redact token query strings
at ingress before sending. Use the production provider settings, not the mock.

Approve recipients and a send limit before starting. The complete scenario sends
four messages per language: welcome, verification, reset link and an automatic
password-change alert. Allow eight for EN/RU or four for a single-locale fork.
Use only retained languages and approved recipients.

1. Register a test account in the first supported language. Observe both welcome and verification mail.
   Correlate the welcome's worker job completion with the provider message and receipt.
2. Open the verification link on the intended HTTPS origin. Confirm the matching
   language and verified account state. Never copy the live URL into logs or reports.
3. Request password recovery. Check the received link's origin and language, set
   a new test password, and verify sign-in. Reusing the consumed token must fail.
   Confirm the automatic password-change alert from the notification worker.
4. Repeat with a separate account for each other supported language.

```text
Registration -> API -> verification email
             -> email queue -> worker -> welcome email
Password recovery -> API -> reset-link email
Password changed -> notification worker -> security email
```

Record these results separately: application response, welcome job completion,
security-notification delivery, provider acceptance/message ID, provider delivery
event, actual mailbox receipt, language/link checks and successful account action.
Resend `delivered` means the recipient mail server accepted the message; it does not prove inbox placement.
Check spam separately. A product HTTP 200/201 does not prove any mail arrived.

Observe the provider and mailbox for up to ten minutes. Missing receipt is unresolved,
not proof that no message was sent. Do not automatically resend after timeout or
connection loss. Inspect the existing attempt before approving another send; obey
the agreed limit. Test provider failure with local doubles instead of deliberately
sending invalid mail through a real account. Direct verification and reset mail
have no queue retry.

Keep only allowlisted IDs, status codes, timestamps and test outcomes in evidence.
A full provider retrieve response includes recipient data, rendered bodies and live
links; never dump it. Mailbox inspection needs its own authorization. A direct provider
test message proves API provider acceptance only, not the worker or account links.
For artifact identity and HTTPS checks, use the
[registry rollout](../operations/deployment.md#production-rollout-via-registry-image-pull-path).
