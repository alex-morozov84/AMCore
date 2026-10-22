# Integrations

[Operations Console](README.md) → Integrations

Integrations shows which outside services the platform uses (email, file storage,
sign-in providers, the queue broker, AI and Telegram), whether they are set up, and
what was last confirmed about them. Open it when a user reports that an email did not
arrive, to see in one place whether outgoing mail works, without reading server
settings. It has one action: **Send test email**, which sends a message to your own
address.

Console access requires a current platform `SUPER_ADMIN`. API keys cannot use this
screen, and an organization role does not grant access. The page is at
`/admin/integrations` in path mode and at `/integrations` on the Console host, after
the locale prefix (for example `/en/admin/integrations`).

## What you see

One row per integration (one card per integration on a narrow screen). **Data read**
above the rows is the time the server read them. **Refresh** and **Auto-refresh**
reload that data every 30 seconds while the tab is visible and online. They never start
a check and never send an email.

| Column         | What it tells you                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Service**    | The name and one headline word (see below).                                                                                |
| **Provider**   | Safe facts: the provider or driver, the sender domain, counts. Never a key, address, URL or bucket name.                   |
| **Setup**      | **Set up** means the required settings exist. It does not prove that they work. **Not set up** and **Off** are also shown. |
| **Last check** | What was last observed, when, where, and the reason if it failed. A configuration-only row says **Not verified**.          |
| **Action**     | **Send test email** and **Last test** on the email row; links to the page that has more detail for the others.             |

### Headline word

Each row has one word for scanning. The columns beside it are the facts behind it.

| Headline                      | Meaning                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Cannot read**               | This row could not be read now. The other rows are not affected.                                      |
| **Off** / **Not set up**      | The module is switched off, or its required settings are missing.                                     |
| **Set up, not verified**      | Settings exist but nothing has confirmed them. This is the normal state for AI, sign-in and Telegram. |
| **Working (as last checked)** | The last check succeeded and is still recent. It says nothing about the time after that check.        |
| **Last check is old**         | The last check succeeded, but longer ago than its freshness limit.                                    |
| **Failed**                    | The last check failed. The row keeps showing it when the check is old; the age is shown beside it.    |
| **Outcome unknown**           | A check ran and could not establish whether it worked, for example after a timeout.                   |
| **Simulated (mock provider)** | The mock provider is in use, so nothing real was sent. It is never shown as working.                  |
| **Test in progress**          | A test email is still running.                                                                        |

### What each row proves

| Row                   | Source                                                                                                    | What it proves                                                                                                                                                                        | Freshness limit                |
| --------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **Email**             | Provider settings, and the latest stored test result of the whole platform (**Last test** opens your own) | After an **Accepted** test: the provider accepted a direct send from the API server. Never queued email, invitations or an inbox. **Simulated** proves nothing about a real provider. | 24 hours                       |
| **Files**             | The storage check that the API runs by itself (write, read and delete of its own test file)               | The answering API server could use the storage. Other servers are not covered.                                                                                                        | Three times the check interval |
| **Sign-in providers** | Settings                                                                                                  | Nothing about sign-in itself. A configured provider does not prove that a user can sign in.                                                                                           | none                           |
| **Queue**             | A short read-only question to the broker                                                                  | The broker answered. It does not prove that workers run. Queue depths are on Background work.                                                                                         | 1 minute                       |
| **AI**                | The cached catalogue of enabled providers and models                                                      | Only configuration. It counts providers that have an enabled model and whether a key is present. It is not a call to any provider and can be up to 5 minutes old.                     | none                           |
| **Telegram**          | Settings of the notification channel                                                                      | Nothing about reachability. Whether this server can reach Telegram is not checked yet.                                                                                                | none                           |

Reading this page never sends an email and never calls an outside provider. Files shows
what the API already observed. Queue asks the broker one short, bounded, read-only
question when the page is read; it starts no work. The email row shows the latest stored
test result of the platform, which can be another operator's.

## Send a test email

Use it to answer one question: is the configured email provider accepting mail from this
server right now?

### Before you start

- Your account has a verified email address. The test goes only there; you cannot enter
  another recipient, subject or text.
- The email provider is not the mock provider in production. In a production deployment
  with mock email the button is disabled and says why.
- You can re-enter your password when asked.
- Your browser is online. Offline, the button is disabled and says why, because the result
  could not be read back.

### Steps

1. In the **Email** row, select **Send test email**.
2. Read the confirmation. It shows your address in masked form (for example
   `o***@example.com`). With a real provider it counts toward the provider's limits. With the mock provider (not allowed in production) nothing leaves the server and the result is **Simulated**.
3. Select **Send test**. Enter your password if the Console asks for it.
4. Read the result window.

### Results

| Result              | What happened                                                                                                                  | Next step                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| **Accepted**        | The provider took the message. This does not prove that it reached an inbox.                                                   | If users still get no mail, check spam folders and the provider's delivery log.                                   |
| **Simulated**       | The mock provider is in use. Nothing was sent.                                                                                 | Configure a real provider for production.                                                                         |
| **Refused**         | The provider rejected the request. The reason is one of: key not accepted, sender rejected, request rejected.                  | Check the provider key and the sender address in the mail settings.                                               |
| **Outcome unknown** | The provider may or may not have accepted the message: no answer in time, a lost connection, or a limit or quota was reported. | Wait a minute and reopen the result. Do not assume the email was not sent. Start a new test only if you need one. |
| **Did not start**   | The test stopped before anything was sent (for example the audit record could not be written).                                 | Start a new test.                                                                                                 |

The Console never shows the provider's own error text. A reported limit or quota is
shown as **Outcome unknown** with the note that the provider reported a limit: the
Console cannot prove from that answer that nothing was accepted.

### Limits

| Limit                        | Value                                               |
| ---------------------------- | --------------------------------------------------- |
| Waiting for the provider     | 10 seconds, then **Outcome unknown**                |
| Per operator                 | One test per minute                                 |
| Whole platform               | 20 tests per hour                                   |
| At the same time             | One test at a time, in normal operation (see below) |
| Time to confirm after step 1 | 30 minutes; after that, start again                 |

The limits are shared by all API servers through Redis.

**One at a time** is a rule for normal operation, not a physical guarantee. A process
pause, an expired 30-second lease, or a provider connection that ignores the 10-second limit
can let a second test start on another server; the per-minute and per-hour limits still
apply. On the same server a new test waits until the earlier connection really ends and
answers **Another test is being sent**.

If Redis is unavailable _before_ the send starts, the test is refused and nothing is sent.
If it becomes unavailable _after_ the send, the window shows the test as still running and
reads the same attempt again: the email may have been sent, and no second one is sent. If
Redis loses its data, stored results disappear (the row says **No stored result**) and an
old confirmation cannot be used. Restoring Redis from an old snapshot is outside these
guarantees.

### If the connection is lost

If the browser loses the answer, the window says it is checking and reads the stored
result of the same attempt. It does not send a second email.

**Send test email** only asks the server for a confirmation; nothing is sent yet. While
your earlier confirmation is still valid and your address and the mail settings are
unchanged, you get the same confirmation back. The email is sent when you confirm, and a
confirmation works once: repeating it returns its stored result and sends nothing. A
reopened result never sends.

### Reopen a result

**Last test** reopens your own latest attempt, or the latest result for the platform when
you have none. It only reads. It never sends. The details of an attempt are kept for
24 hours and the latest result for 7 days; after that the row says **No stored
result**, which is not the same as "never checked". The same text appears if the
provider key, sender or provider type changed after the test, because an old result
must not vouch for new settings.

## Audit

Each test writes **Test email requested** before anything is sent; if that record cannot
be written, the email is not sent. When the server stored a final result it also writes
**Test email finished** with that stored outcome (a result that arrived after the time limit
is recorded as unknown). A test that did not start, or whose result could not be stored, may
have no finished record, so do not expect every request to have a pair. Neither record
contains an email address. Find
them in [Audit](audit.md) under the actions `integration.email_test_requested` and
`integration.email_test_settled`.

## Security

- The page and its API return only closed codes, counts and short safe facts. No keys,
  tokens, addresses, bucket names, URLs or provider error text.
- Only the acting operator's own verified address can receive the test.
- The action needs a current personal `SUPER_ADMIN` session, a recent password check and
  the Console origin; an API key or an organization-exchanged credential is refused.

## Add your own integration

A module can register itself so that it appears here without any change to this page.
See [Register an integration](../backend/integrations.md).

## Reference

- API: `GET /admin/integrations`, `POST /admin/integrations/{id}/probe/prepare`,
  `POST /admin/integrations/{id}/probe`, `GET /admin/integrations/{id}/probe/{attemptId}`.
  The full contract is in the OpenAPI document at `/docs`.
- Related: [Overview](overview.md) (storage and public files), [Background work](background-work.md)
  (queues), [Email security](../email/security.md).
