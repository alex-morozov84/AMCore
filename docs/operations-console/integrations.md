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
a check and never send an email. Labels in this guide are the English ones; the Russian
Console shows translations of the same texts.

| Column         | What it tells you                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Service**    | The name and one headline word (see below).                                                                                |
| **Provider**   | Safe facts: the provider or driver, the sender domain, counts. Never a key, address, URL or bucket name.                   |
| **Setup**      | **Set up** means the required settings exist. It does not prove that they work. **Not set up** and **Off** are also shown. |
| **Last check** | What was last observed, when, where, and the reason if it failed. A configuration-only row says **Not verified**.          |
| **Action**     | **Send test email** and **Last test** on the email row; links to the page that has more detail for the others.             |

### Headline word

Each row has one word for scanning. The columns beside it are the facts behind it.

| Headline                      | Meaning                                                                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cannot read**               | This row could not be read now. The other rows are not affected. Select **Refresh**; if it stays, look in the API server's logs for that integration. |
| **Off** / **Not set up**      | The module is switched off, or its required settings are missing.                                                                                     |
| **Set up, not verified**      | Settings exist but nothing has confirmed them. This is the normal state for AI, sign-in and Telegram.                                                 |
| **Working (as last checked)** | The last check succeeded and is still recent. It says nothing about the time after that check.                                                        |
| **Last check is old**         | The last check succeeded, but longer ago than its freshness limit.                                                                                    |
| **Failed**                    | The last check failed. The row keeps showing it when the check is old; the age is shown beside it.                                                    |
| **Outcome unknown**           | A check ran and could not establish whether it worked, for example after a timeout.                                                                   |
| **Simulated (mock provider)** | The mock provider is in use, so nothing real was sent. It is never shown as working.                                                                  |
| **Test in progress**          | A test email is still running.                                                                                                                        |

### Words in the Last check column

| Word                 | Meaning                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| **Confirmed**        | The last observation succeeded. Its time and where it was taken are shown beside it.                    |
| **Failed**           | The last observation failed. The safe reason is shown beside it.                                        |
| **Outcome unknown**  | A check ran and could not establish whether it worked.                                                  |
| **Simulated**        | The mock provider was used. Nothing real was sent.                                                      |
| **Not verified**     | Nothing was observed. The row shows the settings only (**Configuration only**).                         |
| **No stored result** | The email row has no result for the current settings: none was stored, it expired, or settings changed. |
| **…, old**           | The observation is older than its freshness limit. A failed result stays failed.                        |

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

Words used below: the **confirmation** is the dialog in which you agree to send; an
**attempt** is one test from its confirmation to its result; the **stored result** is the
result of an attempt as saved on the server.

### Before you start

- Your account has a verified email address. The test goes only there; you cannot enter
  another recipient, subject or text. Without one the button is disabled and says **Your
  account has no verified email address.** Verify the address through the product's normal
  email verification (the link sent when the account was created); the Console cannot do it
  for you.
- The email provider is not the mock provider in production. In a production deployment
  with mock email the button is disabled and says why. Configure a real provider first; see
  [Email](../email/README.md). The mail settings are the deployment's environment variables
  `EMAIL_PROVIDER`, `RESEND_API_KEY` and `EMAIL_FROM`; "production" means `NODE_ENV=production`.
- You can re-enter your password when asked. The Console asks when you have not entered it
  in the last 10 minutes.
- Your browser is online. Offline, the button is disabled and says why, because the result
  could not be read back.

### Steps

1. In the **Email** row, select **Send test email**.
2. Read the confirmation. It shows your address in masked form (for example
   `o***@example.com`). With a real provider it counts toward the provider's limits. With the mock provider (not allowed in production) nothing leaves the server and the result is **Simulated**.
3. Select **Send test**. If the Console asks for your password, enter it: the password
   window is part of this step and nothing has been sent while it is open. Closing it sends
   nothing. The email is sent only after the password is accepted, and from that moment it
   cannot be cancelled. Closing the confirmation before step 3 sends nothing.
4. Read the result window.

### Results

| Result              | What happened                                                                                                                  | Next step                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Accepted**        | The provider took the message. This does not prove that it reached an inbox.                                                   | If users still get no mail, check spam folders and the provider's delivery log.                                                                            |
| **Simulated**       | The mock provider is in use. Nothing was sent.                                                                                 | Configure a real provider for production.                                                                                                                  |
| **Refused**         | The provider rejected the request. The reason is one of: key not accepted, sender rejected, request rejected.                  | Check the provider key and the sender address in the mail settings.                                                                                        |
| **Outcome unknown** | The provider may or may not have accepted the message: no answer in time, a lost connection, or a limit or quota was reported. | Wait a minute and reopen the result. Do not assume the email was not sent. Start a new test only if you need one (it must also pass the one-minute limit). |
| **Did not start**   | The test stopped before anything was sent (for example the audit record could not be written).                                 | Start a new test.                                                                                                                                          |

**Outcome unknown** does not change by itself: a late answer from the provider is not
applied. To learn what really happened, read the provider's own log. For **Refused** with
"request rejected", check that the sender address belongs to a domain the provider has
verified and that the key may send mail; the provider's dashboard has the details.

The Console never shows the provider's own error text. A reported limit or quota is
shown as **Outcome unknown** with the note that the provider reported a limit: the
Console cannot prove from that answer that nothing was accepted.

### When the button is unavailable

| Text under the button                           | Meaning                                          | What to do                                                                     |
| ----------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| **A test was started a moment ago. (N s)**      | The one-minute limit of one operator.            | Wait N seconds. The button returns by itself; **Refresh** shows the new time.  |
| **Another test is being sent.**                 | A test is in flight (here or on another server). | Wait, then **Refresh**. Do not try another account or server to get around it. |
| **Your account has no verified email address.** | See Before you start.                            | Verify the address.                                                            |
| **Production email is only simulated.**         | Production uses the mock provider.               | Configure a real provider.                                                     |
| **You are offline.**                            | The result could not be read back.               | Restore the connection.                                                        |

The hourly limit of the platform is not known in advance: the button stays available and
the attempt ends with **The hourly limit for test emails is reached.** Try again later.

### When nothing was sent

| Message                                                                | Meaning                                                      |
| ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| **The confirmation expired. Start the test again.**                    | The confirmation is older than 30 minutes or used.           |
| **Your email address changed…** / **The email settings changed…**      | The confirmation no longer matches. Start again.             |
| **The hourly limit for test emails is reached.**                       | Platform limit (below).                                      |
| **A test was started a moment ago…** / **Another test is being sent.** | See the table above.                                         |
| **The check could not start. Nothing was sent.**                       | Redis or the audit record was unavailable _before_ the send. |

A request refused at the start (the hourly limit, the cooldown, another test in flight) is not
counted. A test that was reserved but did not start (**Did not start**, which includes
**Another test is being sent.** caused by a slow connection on the same server) is counted
toward the per-minute and hourly limits.

### Limits

| Limit                        | Value                                                                 |
| ---------------------------- | --------------------------------------------------------------------- |
| Waiting for the provider     | 10 seconds, then **Outcome unknown**                                  |
| Per operator                 | One test per minute                                                   |
| Whole platform               | 20 tests per hour; the count restarts at the start of each hour (UTC) |
| At the same time             | One test at a time, in normal operation (see below)                   |
| Time to confirm after step 1 | 30 minutes; after that, start again                                   |

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
result of the same attempt. It does not send a second email. If you reload the page while
a test is being sent, nothing is sent again either: open **Last test**, which reads your
attempt.

**Send test email** only asks the server for a confirmation; nothing is sent yet. While
your earlier confirmation is still valid and your address and the mail settings are
unchanged, you get the same confirmation back. The email is sent when you confirm, and a
confirmation works once: repeating it returns its stored result and sends nothing. A
reopened result never sends.

### Reopen a result

**Last test** reopens your own latest attempt, or the latest result for the platform when
you have none. The platform's latest result shows the outcome and the time, never who ran
it. It only reads. It never sends. The **Email** row always shows the platform's latest
result, which can differ from your own attempt that **Last test** opens first. The details
of an attempt are kept for 24 hours; after that **Last test** shows the platform's latest
result. The latest result is kept for 7 days; after that the row says **No stored
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
