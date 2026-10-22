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
   `read(signal)`. It must be quick and free of side effects: no provider call, no email,
   no file write. Return what the module already knows, such as its configuration and the
   result of a check it ran earlier. The module imports the module that exports the
   service, provides the reader and exports it.

   ```ts
   @Injectable()
   class CrmIntegrationReader implements IntegrationReader {
     constructor(private readonly crm: CrmStatusService) {}

     read(): Promise<IntegrationReading> {
       const status = this.crm.lastSyncStatus() // stored, already measured; no call to the CRM
       const staleAfterSeconds = 900
       const stale = Date.now() - status.finishedAt.getTime() > staleAfterSeconds * 1000
       return Promise.resolve({
         configuration: status.enabled ? 'configured' : 'disabled',
         evidence: {
           result: status.lastOk ? 'ok' : 'failed',
           freshness: stale ? 'stale' : 'fresh', // the reader judges age; the page re-judges it while open
           scope: 'provider_request',
           instance: 'shared',
           checkedAt: status.finishedAt.toISOString(),
           staleAfterSeconds,
           failure: status.lastOk ? null : 'timeout',
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

3. **Add copy (optional).** The page shows the registered `name` and a readable form of
   each fact key when it has no message. To localize, add keys to
   `apps/web/messages/en.json` (and every other catalogue) under `console.integrations`:
   `names.crm_sync`, `fact.open_tickets`, and `failure.<code>` for each failure code your
   reader returns. Without them an operator sees the English name, a fact such as
   `open tickets: 4`, and no text for the failure code.

Restart the API. The integration appears on the page. A test runs this exact example:
`apps/api/src/core/admin/integrations/integrations-guide-example.spec.ts`.

To remove an optional module, delete its entry from the composition list. A module that
is not in the list has no row and is not imported by the Console.

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

The pattern only keeps the shape of a fact safe. It does not decide what is safe to show:
a 32-letter API key matches it. Never return a secret, token or address as a fact.

The registry allows at most 32 integrations and gives each row 1.5 seconds, reader and
probe action together. One failing or slow reader never hides the others.

### Evidence

| Field               | Values                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `result`            | `none` (nothing observed for the current configuration), `ok`, `failed`, `unknown` (a check ran and its outcome is not established), `simulated`. |
| `freshness`         | `none`, `fresh`, `stale`. A `failed` result stays `failed` when it is stale.                                                                      |
| `scope`             | `private_file_write_read_delete`, `broker_read`, `provider_acceptance`, `provider_request` or `configuration_only`.                               |
| `instance`          | `answering_instance` (only the API server that answered) or `shared`.                                                                             |
| `checkedAt`         | The time of the observation, or `null`. Never the time the page was read.                                                                         |
| `staleAfterSeconds` | How long the observation stays recent. The page re-judges it while it stays open.                                                                 |
| `failure`           | A closed code, or `null`. Never an error message.                                                                                                 |

A configuration-only integration reports `result: 'none'` and `checkedAt: null`. Do not
give it a time: a refresh must not make a configuration look verified. A new scope is a
reviewed addition to `INTEGRATION_SCOPES` in `packages/shared`, with its message.

## Add an operator probe

A probe is an action the operator starts. v1 supports one kind, `operator_email_test`,
which sends a fixed message to the operator's own verified address. A registration
cannot supply a recipient, URL, subject, text or command. To add a new kind, add it to
`INTEGRATION_PROBE_KINDS` in `packages/shared`, with its copy, its admission strategy and
its limits in `integration-validation.ts`. The kind selects the dialog text and the receipt
wording. This is a reviewed change, not configuration. Pointing a new idea, for example an
arbitrary URL, at an existing kind does not create a new kind.

A probe registration needs every field, and startup fails without them:

| Field    | Rule                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`     | A slug, unique for the integration.                                                                                                                           |
| `kind`   | A member of `INTEGRATION_PROBE_KINDS`.                                                                                                                        |
| `policy` | Whole numbers: `deadlineMs` up to 30 000; `operatorCooldownSeconds` at least 30; `platformPerHour` 1 to 60; `leaseSeconds` at least `deadlineMs / 1000 + 20`. |
| `port`   | A provider implementing `action`, `prepare`, `run` and `receiptFor`.                                                                                          |

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
its kind allows. Disabled registrations are checked too. After all modules start, the
registry resolves each reader and each probe port, compares the instance with its declared
class, and checks that the reader has `read` and the port has `action`, `prepare`, `run` and
`receiptFor`.

## Test your registration

`integrations-guide-example.spec.ts` (the example above) and `integration-registry.spec.ts`
show the pattern: register through `IntegrationsModule.register(...)`, start the module,
and read the list. Assert that your reading passes the schema and that it contains no
secret.

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
