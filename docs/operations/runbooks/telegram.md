# Telegram check

Each worker (`PROCESS_ROLE=worker` or `all`) with `TELEGRAM_BOT_TOKEN` set asks Telegram
`getMe` once a minute through `TELEGRAM_API_BASE_URL`, the same address the notification
delivery uses. The request has no recipient and changes nothing. A successful check proves that
this worker reached Telegram (or the relay) and the bot token was accepted. It does not prove
that a message was delivered, and it does not check incoming messages (the webhook).

The worker publishes the result as `amcore_telegram_reachability_state{state}`; exactly one
state is 1:

| State     | Meaning                                                                           |
| --------- | --------------------------------------------------------------------------------- |
| `ok`      | The last check succeeded within the last 210 seconds.                             |
| `failed`  | The last check failed: no connection, no answer in 8 s, token or request refused. |
| `unknown` | Telegram or the relay answered with a limit, an error or an unexpected body.      |
| `stale`   | The worker's own last check is older than 210 seconds: the check stopped.         |
| `none`    | No check finished since the worker started.                                       |

Without a token the metric does not exist. The optional Operations Console shows the same
results on **Integrations** → **Telegram**.
Delivery of the alert itself needs your own receiver configuration in Alertmanager or the
downstream monitoring system.

## Check failing

`AMCoreTelegramCheckFailing` fires when one worker stayed in `failed`, `unknown` or `stale` for
ten minutes, also when its reason changed in between. Recovery is the next successful check.

```promql
max without (state) (amcore_telegram_reachability_state{state=~"failed|unknown|stale"}) == 1
```

1. Identify the `instance`. Other workers may still be healthy: outgoing network can differ
   per host.
2. From that worker's host or container, check outgoing HTTPS to `api.telegram.org` (or your
   relay): firewall and security group rules, DNS, an outbound proxy. If the hosting provider
   blocks Telegram, run a relay and set `TELEGRAM_API_BASE_URL`; see
   [Notifications](../../notifications/README.md).
3. If the token was refused (the Console says **Telegram or the relay did not accept the bot
   token**), compare `TELEGRAM_BOT_TOKEN` with the token from BotFather and restart the worker.
4. If the request was refused, check `TELEGRAM_API_BASE_URL`: a wrong path on a relay answers
   with an error.
5. A limit or an error from Telegram usually clears by itself; if it stays, check the relay
   logs or Telegram's status.
6. `stale` means the worker's check stopped updating while the worker still answers metrics.
   Look at the worker logs and, with the optional Console, **Scheduled jobs** → **Telegram
   check**.

A worker that Prometheus cannot scrape at all is reported by your `up`/service-discovery
monitoring, not by this metric.

## Check not started

`AMCoreTelegramCheckNotStarted` fires when a worker has been in `none` for fifteen minutes. A
normal start produces a result within about a minute. Check that the worker runs the scheduler
(`PROCESS_ROLE=worker` or `all`) and the worker logs for start-up errors; with the optional
Console, **Scheduled jobs** shows whether **Telegram check** runs.
