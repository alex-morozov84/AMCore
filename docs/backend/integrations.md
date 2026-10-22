# Register an integration

A module that talks to an outside service can register itself so that the Console
[Integrations](../operations-console/integrations.md) page shows it. You write a reader
that reports what is already known, add one line to the composition list, and add copy.
You change nothing in the page, the controller or the frontend.

Use this for services such as a payment provider or a CRM sync. It reports state. It does
not edit settings and it does not run checks when the page is read.

## Register a reader

You need a module that already owns the service your reader uses. In the example it is
`CrmModule`, which exports `CrmStatusService`. Your own names will differ.

1. **Write a reader and a module for it.** The reader is a singleton provider with
   `read(signal)`; `signal` is an `AbortSignal` that is aborted after the 1.5-second row
   budget, and a reader that makes no call, like this one, may ignore it. It must be quick and free of side effects: no provider call, no email,
   no file write. Return what the module already knows, such as its configuration and the
   result of a check it ran earlier. If nothing was ever measured, report the settings only,
   with no time, as the example does (`NOT_MEASURED`). The module imports the module that
   exports the service, provides the reader and exports it.

   ```ts
   const NOT_MEASURED: IntegrationReading['evidence'] = {
     result: 'none',
     freshness: 'none',
     scope: 'configuration_only',
     instance: 'shared',
     checkedAt: null,
     staleAfterSeconds: null,
     failure: null,
   }

   @Injectable()
   class CrmIntegrationReader implements IntegrationReader {
     constructor(private readonly crm: CrmStatusService) {}

     read(): Promise<IntegrationReading> {
       const status = this.crm.lastSyncStatus() // stored, already measured; no call to the CRM
       // 'configured': the required settings exist; 'not_configured': they are missing;
       // 'disabled': the integration is switched off.
       const configuration = status.enabled ? 'configured' : 'disabled'
       if (!status.finishedAt) {
         // Never measured: report the settings only, with no time.
         return Promise.resolve({ configuration, evidence: NOT_MEASURED, facts: [], links: [] })
       }
       const staleAfterSeconds = 900
       const stale = Date.now() - status.finishedAt.getTime() > staleAfterSeconds * 1000
       return Promise.resolve({
         configuration,
         evidence: {
           result: status.lastOk ? 'ok' : 'failed',
           freshness: stale ? 'stale' : 'fresh', // the reader judges age; the page re-judges it while open
           scope: 'provider_request',
           instance: 'shared',
           checkedAt: status.finishedAt.toISOString(),
           staleAfterSeconds,
           failure: status.lastOk ? null : status.failureCode, // a short code, never a message
         },
         facts: [{ key: 'open_tickets', value: status.openTickets }],
         links: [],
       })
     }
   }

   @Module({
     imports: [CrmModule], // the module that exports CrmStatusService
     providers: [CrmIntegrationReader],
     exports: [CrmIntegrationReader],
   })
   class CrmIntegrationModule {}
   ```

2. **Add one entry** to `INTEGRATIONS` in
   `apps/api/src/core/admin/integrations/integrations.composition.ts`:

   ```ts
   {
     id: 'crm_sync',
     name: 'CRM sync',
     module: CrmIntegrationModule,
     reader: CrmIntegrationReader,
   }
   ```

3. **Add copy (optional).** Add no keys and the page falls back: the registered `name`, a
   readable form of each fact key (`open tickets: 4`) and no line for the failure code. To
   localize, add keys under `console.integrations` in `apps/web/messages/en.json` and in
   every other catalogue (`apps/web/messages/ru.json` in the upstream layout):
   `names.crm_sync`, `fact.open_tickets`, and `failure.timeout` for each failure code your
   reader returns. Once you add a key to one catalogue, add it to all of them: a mismatch
   fails a test. For a bilingual product treat the keys as required. The catalogue is
   nested JSON; the path below is relative to `apps/web` (the repository rule calls it
   `messages/en.json`):

   ```json
   {
     "console": {
       "integrations": {
         "names": { "crm_sync": "CRM sync" },
         "fact": { "open_tickets": "Open tickets" },
         "failure": { "timeout": "The CRM did not answer in time" }
       }
     }
   }
   ```

Restart the API. The integration appears on the page. A test runs this exact example:
`apps/api/src/core/admin/integrations/integrations-guide-example.spec.ts`.

To remove an integration your product does not need, delete its entry from the composition
list and restart the API. It then has no row and the Console no longer imports
`CrmIntegrationModule`. Your own module (`CrmModule`) is not touched; if the Console was
the only place that imported it, import it where it belongs. Delete the reader files and the
messages yourself if you no longer need them.

## The reading contract

A reading is validated against a strict schema before it leaves the API. A reading that
breaks the contract shows the row as **Cannot read** and never reaches the browser.

| Field           | Rule                                                                                                                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | `^[a-z][a-z0-9_]{0,31}$`, unique. Never reuse an id for a different integration.                                                                                                                                                  |
| `name`          | 1 to 48 characters. English fallback.                                                                                                                                                                                             |
| `configuration` | `disabled`, `not_configured` or `configured`. `configured` means the required settings exist. It never means working.                                                                                                             |
| `evidence`      | What the last observation established, kept separate from configuration (below).                                                                                                                                                  |
| `facts`         | At most 12 `{ key, value }`. The key is a slug like an id (`^[a-z][a-z0-9_]{0,31}$`). The value is a non-negative integer, a boolean, or a string of up to 64 characters from `A-Z a-z 0-9 . _ space + , -`. No URL, `@` or path. |
| `links`         | A subset of `overview`, `background_work`, `runbook`. You cannot supply a URL.                                                                                                                                                    |

The pattern only keeps the shape of a fact safe. It does not decide what is safe to show:
a 32-letter API key matches it. Never return a secret, token or address as a fact.

The registry allows at most 32 integrations and gives each row 1.5 seconds, the reader and
the probe `action` together. `action` only reports whether the button may be used (a cheap
read); the send itself, `run`, has its own deadline from the policy. One failing or slow
reader never hides the others. A negative or fractional number is not a valid fact. The
registry does not log why a reading was rejected, so check your reading with a test.

### Evidence

| Field               | Values                                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `result`            | `none` (nothing observed for the current configuration), `ok`, `failed`, `unknown` (a check ran and its outcome is not established), `simulated`.                                    |
| `freshness`         | `none`, `fresh`, `stale`. A `failed` result stays `failed` when it is stale.                                                                                                         |
| `scope`             | `private_file_write_read_delete`, `broker_read`, `provider_acceptance`, `provider_request` or `configuration_only`.                                                                  |
| `instance`          | `answering_instance` (only the API server that answered) or `shared`.                                                                                                                |
| `checkedAt`         | The time of the observation, or `null`. Never the time the page was read.                                                                                                            |
| `staleAfterSeconds` | How long the observation stays recent. The page re-judges it while it stays open.                                                                                                    |
| `failure`           | A short lowercase code (`^[a-z][a-z0-9_]{0,31}$`) of your choosing, or `null`. There is no fixed list: add a `failure.<code>` message for each code you use. Never an error message. |

| Scope                            | Use it when the observation proves           |
| -------------------------------- | -------------------------------------------- |
| `private_file_write_read_delete` | a file could be written, read and deleted    |
| `broker_read`                    | the queue broker answered a read             |
| `provider_acceptance`            | an outside provider accepted a direct send   |
| `provider_request`               | a request to an outside service was answered |
| `configuration_only`             | nothing: only settings are known             |

Use `instance: 'answering_instance'` when only the API server that answered observed it
(for example its own storage check) and `'shared'` when every server sees the same stored
result. If the settings changed since the observation, report `result: 'none'`: an old
result must not vouch for new settings (the email test does this).

A configuration-only integration reports `result: 'none'` and `checkedAt: null`. Do not
give it a time: a refresh must not make a configuration look verified. A new scope is a
reviewed addition to `INTEGRATION_SCOPES` in `packages/shared`, with its message.

## Add an operator probe

A probe is an action the operator starts. v1 supports one kind, `operator_email_test`,
which sends a fixed message to the operator's own verified address. A registration
cannot supply a recipient, URL, subject, text or command. To add a new kind, add it to
`INTEGRATION_PROBE_KINDS` in `packages/shared`, with its copy, its admission strategy and
its limits in `integration-validation.ts`. The **admission strategy** is the code that
decides whether a test may start: cooldown, hourly cap, one test in flight, and the audit
record before the send; for the email test it is `EmailTestStore` and `EmailTestProbe`. The
kind selects the dialog text and the receipt wording. This is a reviewed change, not
configuration. The kind decides the strategy and its ceilings, the registry checks the
registered numbers against them, and the port carries the strategy out. Pointing a new idea,
for example an arbitrary URL, at an existing kind does not create a new kind.

The probe is a field of the integration's entry in `INTEGRATIONS`:

```ts
{
  id: 'crm_sync',
  name: 'CRM sync',
  module: CrmIntegrationModule,
  reader: CrmIntegrationReader,
  probe: {
    id: 'crm_email_test',
    kind: 'operator_email_test',
    policy: { deadlineMs: 8_000, operatorCooldownSeconds: 120, platformPerHour: 10, leaseSeconds: 30 },
    port: CrmEmailTestPort, // a provider of the module above
  },
}
```

The port implements this interface (`apps/api/src/core/admin/integrations/integration.types.ts`):

```ts
interface IntegrationProbePort {
  action(actorId: string): Promise<IntegrationAction> // may the button be used now, and why not
  prepare(actorId: string): Promise<ProbePreparation> // issue a single-use attempt id; sends nothing
  run(actorId: string, attemptId: string, policy: IntegrationProbePolicy): Promise<ProbeReceipt>
  receiptFor(actorId: string, attemptId: string): Promise<ProbeReceipt> // read-only recovery
}
```

In v1 the shipped email test (`EmailTestProbe`) is the only port of its kind. A second
integration that uses the same kind registers a port that **delegates to the same admission
and send code** (`EmailTestStore`, `EmailTestProbe`) and supplies only what differs. Do not
reimplement the admission. List the port in `providers` (and `exports`, like the reader) of
your integration module. The recipient is never part of the registration: the shipped port
reads the verified address from the acting operator's account.

A probe registration needs every field, and startup fails without them:

| Field    | Rule                                                                                                                                                                                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`     | A slug, unique for the integration.                                                                                                                                                                                                                                    |
| `kind`   | A member of `INTEGRATION_PROBE_KINDS`.                                                                                                                                                                                                                                 |
| `policy` | Whole numbers: `deadlineMs` up to 30 000; `operatorCooldownSeconds` at least 30; `platformPerHour` 1 to 60; `leaseSeconds` at least `deadlineMs / 1000 + 20`. These are the general bounds. Your kind has a stricter ceiling (next section); the stricter one applies. |
| `port`   | A provider implementing `action`, `prepare`, `run` and `receiptFor`.                                                                                                                                                                                                   |

### How the policy is applied

The controller hands the **registered** policy to `port.run(actorId, attemptId, policy)`.
The port must use it. For the operator email test, `EmailTestStore.reserve` takes the
cooldown, the hourly cap and the lease from it, and the time budget of the send comes from
`deadlineMs`. Changing the registered cooldown therefore changes the real admission. The
tests `email-test-attempt.redis.e2e-spec.ts` ("applies the registered policy") and
`email-test.probe.spec.ts` ("the registered policy drives the execution") prove it.

Each kind has a ceiling in `integration-validation.ts`. A registration may be stricter than
its kind and never looser: for `operator_email_test`, a cooldown below 60 seconds, more than
20 tests per hour or a deadline above 10 seconds fails startup.

The registry cannot see inside a port. A port that ignores the policy it receives is a
defect that review and the port's own tests must catch. Use the email test as the model.

## What the registry checks at startup

Startup fails with a clear message for: a bad or duplicate id, a name over 48 characters,
a missing reader, two registrations that share a reader, a probe with a missing field, an
unknown probe kind, and a policy that is not made of finite whole numbers or is looser than
its kind allows. A registration is checked even when your product switches its module off (its reader
reports `disabled`).

The check has two stages. When the registry is created, it validates the registrations
above. After all modules have started, it resolves each reader and each probe port, compares
the instance with its declared class, and checks that the reader has `read` and the port
has `action`, `prepare`, `run` and `receiptFor`. A failure in either stage stops the API
from starting; it does not only mark one row. A reading that breaks the schema later, when
the page is read, only turns that row into **Cannot read**.

## Test your registration

`integrations-guide-example.spec.ts` (the example above) and `integration-registry.spec.ts`
show the pattern: register through `IntegrationsModule.register(...)`, start the module,
and read the list. Assert that your reading passes the schema and that it contains no
secret. Two assertions that are worth copying:

```ts
// the reading shows no secret
const text = JSON.stringify(await registry.list('operator'))
expect(text).not.toContain(process.env.CRM_API_KEY!)

// the declared policy reaches the admission (fake store, as in email-test.probe.spec.ts)
const strict = { ...POLICY, operatorCooldownSeconds: 120 }
await port.run('u1', attemptId, strict)
expect(store.reserve).toHaveBeenCalledWith(expect.objectContaining({ policy: strict }))
```

```bash
pnpm --filter api test -- src/core/admin/integrations
```

## Rules to keep

- A reader never calls the service. Run the check elsewhere and let the reader report its
  stored result: a scheduled job (see [Scheduled jobs](scheduled-jobs.md)), a worker, or your
  service after each sync. The reader only reads what they stored.
- Never put a key, token, URL, address or provider message into a reading, a log or an
  audit record.
- Give every observation a real `checkedAt`. If you cannot, report `none`.
- Say what the observation proves in `scope`. A successful send to a provider is not
  delivery to an inbox.

The state of a probe attempt, its limits and its retention are described for operators in
[Integrations](../operations-console/integrations.md#send-a-test-email).
