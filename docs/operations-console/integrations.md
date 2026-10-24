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
above the rows is the time the server read them. **Refresh** reloads that data at once. **Auto-refresh** does it every 30 seconds while the
tab is visible and online. They never start
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

| Headline                      | Meaning                                                                                                                                                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cannot read**               | This row could not be read now. The other rows are not affected. Select **Refresh**; if it stays, look in the API server's logs for that integration.                                                            |
| **Off** / **Not set up**      | The module is switched off, or its required settings are missing.                                                                                                                                                |
| **Set up, not verified**      | Settings exist but nothing has confirmed them. This is the normal state for AI and sign-in, and for Telegram until a worker has reported its check.                                                              |
| **Working (as last checked)** | The last check succeeded and is still recent. It says nothing about the time after that check.                                                                                                                   |
| **Check passed**              | Telegram only, in place of **Working (as last checked)**: the workers reached Telegram and it accepted the bot token. It does not prove that messages are delivered. An old success shows **Last check is old**. |
| **Last check is old**         | The last check succeeded, but longer ago than its freshness limit.                                                                                                                                               |
| **Failed**                    | The last check failed. The row keeps showing it when the check is old; the age is shown beside it.                                                                                                               |
| **Outcome unknown**           | A check ran and could not establish whether it worked, for example after a timeout.                                                                                                                              |
| **Simulated (mock provider)** | The mock provider is in use, so nothing real was sent. It is never shown as working.                                                                                                                             |
| **Test in progress**          | A test email is still running.                                                                                                                                                                                   |

### Words in the Last check column

| Word                 | Meaning                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Confirmed**        | The last observation succeeded. Its time and where it was taken (**this server**, **shared** or **workers**) are shown beside it. |
| **Failed**           | The last observation failed. The safe reason is shown beside it.                                                                  |
| **Outcome unknown**  | A check ran and could not establish whether it worked.                                                                            |
| **Simulated**        | The mock provider was used. Nothing real was sent.                                                                                |
| **Not verified**     | Nothing was observed. The row shows the settings only (**Configuration only**).                                                   |
| **No stored result** | The email row has no result for the current settings: none was stored, it expired, or settings changed.                           |
| **…, old**           | The observation is older than its freshness limit. A failed result stays failed.                                                  |

### What each row proves

| Row                   | Source                                                                                                    | What it proves                                                                                                                                                                        | Freshness limit                |
| --------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **Email**             | Provider settings, and the latest stored test result of the whole platform (**Last test** opens your own) | After an **Accepted** test: the provider accepted a direct send from the API server. Never queued email, invitations or an inbox. **Simulated** proves nothing about a real provider. | 24 hours                       |
| **Files**             | The storage check that the API runs by itself (write, read and delete of its own test file)               | The answering API server could use the storage. Other servers are not covered.                                                                                                        | Three times the check interval |
| **Sign-in providers** | Settings                                                                                                  | Nothing about sign-in itself. A configured provider does not prove that a user can sign in.                                                                                           | none                           |
| **Queue**             | A short read-only question to the broker                                                                  | The broker answered. It does not prove that workers run. Queue depths are on Background work.                                                                                         | 1 minute                       |
| **AI**                | The cached catalogue of enabled providers and models                                                      | Only configuration. It counts providers that have an enabled model and whether a key is present. It is not a call to any provider and can be up to 5 minutes old.                     | none                           |
| **Telegram**          | The check each worker runs by itself every minute (see [Telegram check](#telegram-check))                 | The workers that reported could reach Telegram, and it accepted the bot token. Not message delivery, not incoming messages.                                                           | 210 seconds                    |

Reading this page never sends an email and never calls an outside provider. Files shows
what the API already observed; Telegram shows what the workers stored. Queue asks the broker one short, bounded, read-only
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

| Result              | What happened                                                                                                                  | Next step                                                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Accepted**        | The provider took the message. This does not prove that it reached an inbox.                                                   | If users still get no mail, check spam folders, the provider's delivery log and **Background work** (queued email and invitations are not covered by this test).                                                               |
| **Simulated**       | The mock provider is in use. Nothing was sent.                                                                                 | Configure a real provider for production.                                                                                                                                                                                      |
| **Refused**         | The provider rejected the request. The reason is one of: key not accepted, sender rejected, request rejected.                  | Check the provider key and the sender address in the mail settings.                                                                                                                                                            |
| **Outcome unknown** | The provider may or may not have accepted the message: no answer in time, a lost connection, or a limit or quota was reported. | Reopen the result once the provider log shows what happened (the Console result itself stays as stored). Do not assume the email was not sent. Start a new test only if you need one (it must also pass the one-minute limit). |
| **Did not start**   | The test stopped before anything was sent (for example the audit record could not be written).                                 | Start a new test.                                                                                                                                                                                                              |

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

| Message                                                                | Meaning                                                                                                                                                                                                              |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The confirmation expired. Start the test again.**                    | A confirmation that was not yet used is older than 30 minutes. A confirmation that was already used returns its stored result instead; if that result is gone, it is **No stored result** and nothing is sent again. |
| **Your email address changed…** / **The email settings changed…**      | The confirmation no longer matches. Start again.                                                                                                                                                                     |
| **The hourly limit for test emails is reached.**                       | Platform limit (below).                                                                                                                                                                                              |
| **A test was started a moment ago…** / **Another test is being sent.** | See the table above.                                                                                                                                                                                                 |
| **The check could not start. Nothing was sent.**                       | Redis or the audit record was unavailable _before_ the send.                                                                                                                                                         |

A request refused before the test was reserved (the hourly limit, the cooldown) is not counted.
**Another test is being sent.** can also appear after the reservation, when the start then fails:
that attempt is recorded as **Did not start** and is counted toward the per-minute and hourly
limits. The message alone does not show which case you have, so do not assume the limits are
unused. Wait for the cooldown shown on the button.

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

## Telegram check

Use it to answer one question: can the servers that send Telegram messages reach Telegram
with the configured bot token right now? This is the case where a server's outgoing access to
`api.telegram.org` is closed and the bot stops sending without any error a user sees.

Each worker (a process with `PROCESS_ROLE=worker` or `all`, which sends the notifications) asks
Telegram `getMe` once a minute. The
request is free, has no recipient and changes nothing. It goes to the same address the
messages use, so a configured relay (`TELEGRAM_API_BASE_URL`) is checked too. There is no
button: the check runs without you, and **Refresh** and **Auto-refresh** only read what the
workers stored. The check runs only when `TELEGRAM_BOT_TOKEN` is set.

A failure appears on the row about one to two minutes after it starts: up to one minute until
the next check, up to 8 seconds for the answer, and up to 30 seconds until **Auto-refresh**
reads it. To be told without opening the Console, alert on the metric (see
[Get an alert](#get-an-alert)).

### What the row shows

- **Provider** column: **Workers reporting** is the number of workers whose result for the
  current settings is stored. **Failed** counts those whose latest result failed, recent or old.
  **No recent result** counts those whose latest result is older than 210 seconds. Both appear
  only when they are not zero. **Checked every 60 s** is the interval.
- One success has three names: **Check passed** in the headline, **Confirmed** in **Last
  check** and `ok` in the metric.
- **Last check** column: the result; for a failure or an unclear result, the reason right under
  it; then its time and **workers**; then what the check covers.
- With several workers the row shows the most important result: a recent failure first, then
  a recent unclear result, then an old failure, then an old result, and only when every worker
  reported a recent success, **Confirmed**. The time is the time of the result that decided the
  row, so another worker's newer success never hides an older failure.
- Only results for the current settings (the API server's token and address) decide the row
  and are counted in **Workers reporting**. **Results for other settings: N** shows workers that
  still report with other values; they are not counted and do not make the row fail. **Not
  verified — settings changed since the last check** appears only when no current result exists.
  After a partial restart, the restarted workers decide the row and the others are shown as
  **Results for other settings**.
- The row counts the workers that reported. It cannot tell whether a worker never reported (an
  older version, a worker that never started, a worker that uses another Redis). Compare
  **Workers reporting** with the number of workers you run.
- The row does not name a worker. To find the one that fails, use the `instance` label of the
  metric, which is the address Prometheus scrapes for that worker (see
  [Get an alert](#get-an-alert)); without Prometheus, run the network check below on each
  worker's host.

### Reasons and next steps

| Reason on the row                                                   | Result          | Next step                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **the server cannot reach Telegram**                                | Failed          | From the worker's host or container, check outgoing HTTPS to `api.telegram.org` (or to your relay) without the token, for example `curl -sS -o /dev/null -w '%{http_code}\n' https://api.telegram.org/` (for a relay, its base address): any HTTP code, 404 included, means the network path works; a timeout or connection error means it is blocked. Then check firewall, DNS, proxy. If the provider blocks Telegram, configure a relay.                                                                                                                                      |
| **Telegram did not answer within 8 s**                              | Failed          | The same network checks; a very slow path or a relay that does not answer also ends here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Telegram or the relay did not accept the bot token**              | Failed          | Check `TELEGRAM_BOT_TOKEN` against the token from BotFather. If you use a relay, check that the relay forwards the token. After changing it, restart the workers and the API server: both must use the same token. If you use the webhook, register it again with the new token ([Telegram webhook registration](../operations/deployment.md#telegram-webhook-registration-one-shot-optional)).                                                                                                                                                                                  |
| **Telegram or the relay refused the request**                       | Failed          | Usually a wrong `TELEGRAM_API_BASE_URL` (a path that does not exist on the relay). Check the address.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Telegram reported a request limit**                               | Outcome unknown | Wait; change no settings. Telegram limits the bot (the check itself is one request per worker per minute); deliveries wait and retry on their own. The next checks show whether it recovers; after 10 minutes the alert fires, then check the relay logs and Telegram's status.                                                                                                                                                                                                                                                                                                  |
| **Telegram or the relay reported an error** / **unexpected answer** | Outcome unknown | Wait for the next checks. If it stays, check the relay's logs or Telegram's status.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **more workers report than can be stored**                          | Outcome unknown | More than 32 workers wrote a result within an hour (for example after many restarts). The row stays like this for one hour after the last refused result.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **a stored result could not be read**                               | Outcome unknown | A stored value has a format this server does not read, usually because workers and the API server run different AMCore versions, or the value was changed by hand. Run the same version everywhere. A damaged value disappears at most one hour after it was written.                                                                                                                                                                                                                                                                                                            |
| **settings changed since the last check**                           | Not verified    | Results exist only for other settings: the token or address of the workers differs from the API server's. Both must use the same `TELEGRAM_BOT_TOKEN` and `TELEGRAM_API_BASE_URL`. The Console does not show which process has the old values: compare the variables of the API server and of each worker without printing the token, for example `printf %s "$TELEGRAM_BOT_TOKEN" \| sha256sum` on each. This also appears when only the API server still has the old values. Restart the processes that still have them; workers with the new settings report within a minute. |

**Not verified** without a reason means no worker has reported yet: wait a minute after the
workers start. If it stays, look at **Scheduled jobs** → **Telegram check**: that row tells
whether the check itself runs on the workers. It shows the latest run of any worker, not each
worker; the metric shows each one. A check that ran and found Telegram unreachable is a
successful run there; the result is only on this page.

**Check passed, but a user got no message.** The check does not cover delivery. Open
[Background work](background-work.md#notification-deliveries) → **Notification deliveries**,
choose the Telegram channel and a state: delivered, skipped (for example, the user has no
linked Telegram) and cancelled rows are told apart, and **Attempt history** shows the latest
attempts of one delivery.

### Old and missing results

A result is recent for 210 seconds. After that the row says it is old; a failure stays
**Failed**. When a worker stops normally, it removes its result within about 5 seconds, and the
counts drop at the next read. If Redis does not answer at that moment, the result stays and ages
as after a crash. When a worker crashes or is killed, its last result stays, becomes old
210 seconds after that check and is no longer counted one hour after it. The times are shown in the API server's clock; if the servers'
clocks differ, the exact minute may differ from the worker's logs, but the age is right. The
row is the state at the moment shown in **Data read**; while the page stays open only the age
changes, and the next read brings the other workers' new results.

If Redis is unavailable, the row says **Cannot read**. A worker that cannot store its result
still updates its metric.

### Get an alert

Each worker publishes `amcore_telegram_reachability_state` with one of `ok`, `failed`,
`unknown`, `stale` (its own check stopped updating) or `none` (no result since it started).
The example rules `AMCoreTelegramCheckFailing` and `AMCoreTelegramCheckNotStarted` in
[`amcore-alerts.yml`](../operations/prometheus/amcore-alerts.yml) alert per worker; see
[Observability](../operations/observability.md). A worker that Prometheus cannot scrape is
reported by your usual `up` monitoring, not by this metric. Without a token the metric does not
exist and nothing alerts.

## Audit

Each test writes **Test email requested** before anything is sent; if that record cannot
be written, the email is not sent. When the server stored a final result it also writes
**Test email finished** (action `integration.email_test_settled`) with that stored outcome (a result that arrived after the time limit
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
