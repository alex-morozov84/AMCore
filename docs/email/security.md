# Email Security

Email is a common path for secrets: password resets, verification links, org
invites, magic links, and product-specific token URLs. AMCore's contract is that
secret-bearing email data is never serialized into shared infrastructure.

## Invariants

- Secret token URLs must never be persisted in BullMQ, Redis, Bull Board,
  notification payloads, audit logs, metrics, or application logs.
- `SendEmailJobData` is restricted to queueable templates at compile time.
- `EmailService.queue()` rejects non-queueable templates at runtime.
- `EmailProcessor` discards injected legacy secret-bearing jobs before rendering
  or sending.
- Notification definitions reject `SECRET` content entirely.
- Logs may include bounded metadata such as template, recipient, job id, and
  provider status, but never rendered bodies or raw payload objects.

## Allowed Metadata

Application logs may contain:

- template name;
- recipient email address;
- provider success/failure status;
- bounded job or delivery identifiers;
- retryability classification.

Application logs must not contain:

- rendered HTML;
- plaintext email bodies;
- raw template payload objects;
- token URLs;
- provider request bodies.

## Bull Board Implication

Bull Board can display job payloads to authorized operators. Therefore the
primary safety rule is stronger than "protect Bull Board": secret-bearing
templates must never be enqueued at all.

## Extension Checklist

- Classify the email: notification, queueable, direct, or secret-bearing.
- Keep secret-bearing templates on `sendNow()` and out of queue schemas.
- Add queue schema/tests for queueable templates.
- Add subjects/messages for every supported locale.
- Add HTML and plaintext render tests.
- Verify provider/logging paths do not expose rendered bodies or payload values.
