# Register an integration

A module that talks to an outside service can register itself so that the Console
[Integrations](../operations-console/integrations.md) page shows it. You write a reader
that reports what is already known, add one line to the composition list, and add copy.
You change nothing in the page, the controller or the frontend.

Use this for services such as a payment provider or a CRM sync. It reports state. It does
not edit settings and it does not run checks when the page is read.

## Register a reader

1. **Write a reader.** A singleton provider with `read(signal)`. It must be quick and
   free of side effects: no provider call, no email, no file write. Return what the module
   already knows, such as its configuration and the result of a check it ran earlier.

   ```ts
   @Injectable()
   export class CrmIntegrationReader implements IntegrationReader {
     constructor(private readonly crm: CrmStatusService) {}

     async read(): Promise<IntegrationReading> {
       const status = this.crm.lastSyncStatus() // cached, already measured
       const staleAfterSeconds = 900
       const stale = Date.now() - status.finishedAt.getTime() > staleAfterSeconds * 1000
       return {
         configuration: status.enabled ? 'configured' : 'disabled',
         evidence: {
           result: status.lastOk ? 'ok' : 'failed',
           freshness: stale ? 'stale' : 'fresh', // the reader judges age; the page re-judges it while open
           scope: 'provider_acceptance',
           instance: 'shared',
           checkedAt: status.finishedAt.toISOString(),
           staleAfterSeconds,
           failure: status.lastOk ? null : 'timeout',
         },
         facts: [{ key: 'open_tickets', value: status.openTickets }],
         links: [],
       }
     }
   }

   @Module({ providers: [CrmIntegrationReader], exports: [CrmIntegrationReader] })
   export class CrmIntegrationModule {}
   ```

2. **Add one entry** to `INTEGRATIONS` in
   `apps/api/src/core/admin/integrations/integrations.composition.ts`:

   ```ts
   { id: 'crm_sync', name: 'CRM sync', module: CrmIntegrationModule, reader: CrmIntegrationReader }
   ```

3. **Add copy (optional).** The page shows the registered `name`, and a readable form of
   each fact key, when it has no message. To localize, add keys to
   `apps/web/messages/en.json` (and every other catalogue) under `console.integrations`:
   `names.crm_sync`, `fact.open_tickets`, and `failure.<code>` for each failure code
   your reader returns.

Restart the API. The integration appears on the page.

To remove an optional module, delete its line from the composition list. A module that is
not in the list has no row and is not imported by the Console.

## The reading contract

A reading is validated against a strict schema before it leaves the API. A reading that
breaks the contract shows the row as **Cannot read** and never reaches the browser.

| Field           | Rule                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`            | `^[a-z][a-z0-9_]{0,31}$`, unique. Never reuse an id for a different integration.                                                                                         |
| `name`          | 1 to 48 characters. English fallback.                                                                                                                                    |
| `configuration` | `disabled`, `not_configured` or `configured`. `configured` means the required settings exist. It never means working.                                                    |
| `evidence`      | What the last observation established, kept separate from configuration (below).                                                                                         |
| `facts`         | At most 12 `{ key, value }`. The value is a non-negative integer, a boolean, or a string of up to 64 characters from `A-Z a-z 0-9 . _ space + , -`. No URL, `@` or path. |
| `links`         | A subset of `overview`, `background_work`, `runbook`. You cannot supply a URL.                                                                                           |

The registry allows at most 32 integrations and gives each reader 1.5 seconds. One failing
reader never hides the others.

### Evidence

| Field               | Values                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `result`            | `none` (nothing observed for the current configuration), `ok`, `failed`, `unknown` (a check ran and its outcome is not established), `simulated`. |
| `freshness`         | `none`, `fresh`, `stale`. A `failed` result stays `failed` when it is stale.                                                                      |
| `scope`             | `private_file_write_read_delete`, `broker_read`, `provider_acceptance` or `configuration_only`.                                                   |
| `instance`          | `answering_instance` (only the API server that answered) or `shared`.                                                                             |
| `checkedAt`         | The time of the observation, or `null`. Never the time the page was read.                                                                         |
| `staleAfterSeconds` | How long the observation stays recent. The page re-judges it while it stays open.                                                                 |
| `failure`           | A closed code, or `null`. Never an error message.                                                                                                 |

A configuration-only integration reports `result: 'none'` and `checkedAt: null`. Do not
give it a time: a refresh must not make a configuration look verified.

## Add an operator probe

A probe is an action the operator starts. v1 supports one kind, `operator_email_test`,
which sends a fixed message to the operator's own verified address. A registration
cannot supply a recipient, URL, subject, text or command. To add a new kind, add it to
`INTEGRATION_PROBE_KINDS` in `packages/shared`, its copy, and its admission strategy; the
kind selects the dialog text and the receipt wording. This is a reviewed change, not
configuration.

A probe registration needs every field, and startup fails without them:

| Field    | Rule                                                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`     | A slug, unique for the integration.                                                                                                            |
| `kind`   | A member of `INTEGRATION_PROBE_KINDS`.                                                                                                         |
| `policy` | `deadlineMs` up to 30 000; `operatorCooldownSeconds` at least 30; `platformPerHour` 1 to 60; `leaseSeconds` at least `deadlineMs / 1000 + 20`. |
| `port`   | A provider implementing `action`, `prepare`, `run` and `receiptFor`.                                                                           |

The shared admission layer enforces the limits. Read the email test in
`apps/api/src/core/admin/integrations/email-test/` as the reference.

## What the registry checks at startup

Startup fails with a clear message for: a bad or duplicate id, a name over 48 characters,
a missing reader, two registrations that share a reader, a probe with a missing field, an
unknown probe kind and an unsafe policy. Disabled registrations are checked too.
After all modules start, the registry resolves each reader and probe and compares the
instance with its declared class.

## Test your registration

`apps/api/src/core/admin/integrations/integration-registry.spec.ts` shows the pattern:
register a demo reader through `IntegrationsModule.register(...)`, start the module, and
read the list. Assert that your reading passes the schema and that it contains no secret.

```bash
pnpm --filter api test -- src/core/admin/integrations
```

## Rules to keep

- A reader never calls the service. Run checks elsewhere and let the reader report their
  stored result.
- Never put a key, token, URL, address or provider message into a reading, a log or an
  audit record.
- Give every observation a real `checkedAt`. If you cannot, report `none`.
- Say what the observation proves in `scope`. A successful send to a provider is not
  delivery to an inbox.

The state of a probe attempt, its limits and its retention are described for operators in
[Integrations](../operations-console/integrations.md#send-a-test-email).
