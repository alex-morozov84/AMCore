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

Provider error names/messages are untrusted: they can echo a rendered token URL.
The Resend adapter returns and logs only a finite safe failure category, never
raw error messages, arbitrary error names or causes. `sendNow()` also sanitizes
render/custom-provider throws and failed results. Custom adapters must enforce
the same rule inside their own logging; an outer catch cannot remove a log
already emitted by a provider.

## Bull Board Implication

Bull Board lists queued jobs for authorized operators. It is view-only and
shows a closed list of fields (for a welcome email: template, locale and the
user id; never the recipient, the name, a failure message or a stack trace), but
that list is a second line of defence. The primary safety rule is stronger than
"protect Bull Board" or "filter what it shows": secret-bearing templates must never
be enqueued at all.

## Extension Checklist

- Classify the email: notification, queueable, direct, or secret-bearing.
- Keep secret-bearing templates on `sendNow()` and out of queue schemas.
- Add queue schema/tests for queueable templates.
- Add subjects/messages for every supported locale.
- Add HTML and plaintext render tests.
- Verify provider/logging paths do not expose rendered bodies or payload values.
