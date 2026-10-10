# Registering background work

Background work uses one registration collection:
`apps/api/src/background-work.composition.ts`. A registration declares its
definition and lazy Nest module loaders. The application derives queue discovery,
managed producers, worker bindings, safe diagnostics and supported administrative
commands from this collection. Do not add a parallel queue list or per-work
administrative controller.

Read `PROJECT_CONTEXT.md` before extending a checkout. When
`admin_console: disabled`, keep backend registrations, handlers, policies, API and
audit integration. Do not create Console pages, frontend Route Handlers/BFF,
navigation, messages or admin UI scenarios without an explicit owner request.
A backend controller and a frontend BFF Route Handler have separate ownership;
removing the optional frontend does not remove the backend control API.

## Choose the business authority

| Work                | Authority and retry requirement                                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary idempotent | BullMQ owns scheduling; the handler owns durable business deduplication. A repeated handler invocation must return the same business result.                                        |
| Provider-window     | BullMQ owns scheduling; independent PG evidence protects provider certainty, immutable requests, finite starts and the provider retry window. The supported recipe is queued email. |
| Durable             | Business tables own state and eligibility. The adapter changes business state using the framework's transaction, together with receipt and strict audit.                            |
| Wake hint           | The queue only wakes a database-owned subsystem. A hint is not the business result.                                                                                                 |
| External            | Observed queue without the managed producer/handler contract; unsupported commands remain disabled.                                                                                 |

Ordinary handler replay and administrative command replay are different. Business
idempotency permits re-entry after a lost worker acknowledgement. An administrative
command with an unknown result is never dispatched again. Its receipt remains
available for inspection and explicit uncertainty disposition.

## Ordinary work: compiled image recipe

Start with [image-work.ts](../../apps/api/recipes/background-work/image-work.ts)
and [its business table](recipes/image-work.sql). The example stores one result
under `UNIQUE(business_request_id, transform_version)`. Concurrent workers,
retries and a recycled queue ID return that stored reference. Framework execution
evidence is not the deduplication authority for this policy. The recipe accepts
optional safe `productId` and `fileName` metadata, with localized field labels,
to illustrate an operator card for product123 / photo.jpg. These fields do not
change the business deduplication identity. The recipe stores a demonstration
output reference; it does not create a real product or transform an uploaded file.

Copy the recipe into your business module under `apps/api/src/` (for example,
`apps/api/src/core/images/image-work.ts`) and import its registration from that
source path in `background-work.composition.ts`. The `recipes/` directory holds
examples; Nest's production build compiles `src/`, so importing the example path
directly is not a deployment recipe. Add the SQL to your business migration before
starting the registered worker.

1. Define a stable work ID, queue and job bindings with `defineOrdinaryWork()`.
   Each binding declares its wire schema/version, replay policy/version,
   retention and a safe scalar projection. Projections must omit secrets and
   arbitrary payload content.
2. Implement `WorkHandler.run(payload, invocation)`. Keep durable deduplication
   in the business transaction that records the result. Use the invocation's
   abort signal where supported; queue cancellation cannot roll back an already
   started business effect.
3. Export the handler from its Nest module and call `bindWorkHandlers()` with
   every supported `jobName@wireVersion`. An older binding may use `normalize`
   to produce the current handler input; retain an explicit binding for that version.
4. Add the exported registration to `BACKGROUND_WORK`. Its `core` loader supplies
   reusable business providers; its `worker` loader supplies handler bindings.
   The web process never invokes the worker loader. Workers start after startup
   readiness checks, rather than during module discovery.
5. Inject `definition.tokens.producer` as `ManagedProducer<typeof definition>`
   into callers and use `add(jobName, payload, options)`. The producer validates
   payloads/options and returns the actual stored job ID and incarnation,
   including when a duplicate add finds an existing job.

The closed options surface supports job ID, delay, priority and automatic attempts
(1–10). It does not expose replacement retention, flow/dependency editing,
scheduler editing or arbitrary BullMQ options. The managed envelope is limited
to32KiB. Every new stored incarnation gets a distinct identity; broker job IDs
alone are not business deduplication keys.

## Wire data and business normalization

Each version has one `schema` for its stored JSON representation. The producer
accepts that schema's input. It parses and cleans the input, then stores only the
canonical wire output. The schema may strip extra fields, reject them with
`strictObject`, or retain them with explicit `passthrough`. Nested objects follow
their declared schemas. Stripping is intentional; it does not authorize exposing
retained values in a projection.

Optional `normalize` receives the wire schema's output and returns the common
business payload for the handler and safe projection. Without it, normalization
is identity. Current and retained versions must produce compatible business
payloads. For example, the image recipe retains this version without changing its
stored wire contract:

```ts
{
  wireVersion: 1,
  schema: z.strictObject({ businessKey: requestId }),
  normalize: ({ businessKey }: { businessKey: string }) => ({
    businessRequestId: businessKey,
    transformVersion: 1,
  }),
}
```

Wire JSON remains `{ businessKey }`; the handler and projection receive
`{ businessRequestId, transformVersion: 1 }`. The producer tests normalization on
a fresh copy and discards that result. Readers and workers use the same parsing
and normalization boundary. A normalized payload is never stored as wire data or
passed back into the wire schema.

Normalization must be synchronous, deterministic and pure. Do not perform I/O,
read changing external state or mutate its argument. The boundary freezes the
fresh wire copy and rejects asynchronous results. These runtime checks do not
prove an arbitrary callback's purity or determinism. Business code owns those
requirements and tests them.

Before any broker write, the producer validates the entire managed envelope's
32KiB UTF-8 JSON limit. Wire values must survive JSON serialization without loss:
plain objects, dense arrays, strings, booleans, null and finite numbers. Undefined,
negative zero, nonfinite numbers, bigint, functions, symbols, accessors, cycles,
custom object/array prototypes and `toJSON` coercion are refused. Wire traversal
also bounds depth to64 and values to32768. The schema's declared cleaning runs
first; removed fields are not stored. The resulting JSON must parse and validate
again without changing its canonical content. Consumers refuse noncanonical or
unsupported stored data instead of silently cleaning it during observation.

When migrating an existing registration, move shape-changing business transforms
and preprocess operations into `normalize`. Keep the schema for the stored wire
shape. Stable wire canonicalization, such as trimming a string, may remain in the
schema if validating canonical JSON again leaves it unchanged. A transform that
increments a value on every parse is not stable wire canonicalization; implement
that operation in `normalize`. Preserve a retained version's original wire shape.
Change wire or policy versions only when the corresponding contract changes.

Duplicate adds return the existing stored identity and leave its payload intact.
Fingerprints, command CAS and provider identities use stored wire data.
Normalization does not authorize a retry, change execution grants, establish
provider certainty or permit replaying an unknown administrative command.

## Operator names and field labels

Supply `presentation` in the same `defineOrdinaryWork()` or `defineDurableWork()`
definition. This is backend-owned plain display data, not a frontend message key,
HTML, link or separate UI registration:

```ts
presentation: {
  name: { en: 'Image processing', ru: 'Обработка изображений' },
  fields: {
    productId: { en: 'Product', ru: 'Товар' },
    fileName: { en: 'File', ru: 'Файл' },
  },
},
```

Each locale map requires English and accepts at most eight locale entries, each
label 1–80 characters. Supply every locale supported by your product; the Console
uses the exact locale, then its language, then English. At most eight field labels
are allowed, and the whole presentation is limited to4KiB of UTF-8 JSON.
Fields appear in registration order. Optional `technicalFields` lists at most
eight declared field keys to show in collapsed Technical details in both task
cards and action confirmations. For the image recipe, product/file appear first,
while business request ID and transformation version are technical details.
The queue summary reuses the same presentation metadata; downstream does not add
a second naming catalogue. Labels describe keys already returned by the safe projection; they
never expose extra payload data. Keep projecting only explicitly approved scalar
values, without secrets or arbitrary user content. A label does not sanitize a
value. Missing presentation metadata falls back to technical IDs/keys for
compatibility; provide labels for operator-facing registrations.

The catalogue carries this metadata for both queue-owned and database-owned work;
the generic native UI uses it automatically. Technical work IDs remain visible
for diagnostics. Optional Console removal retains this registration recipe and
backend metadata, without recreating frontend pages or translations.

## Failure reporting boundary

The managed worker sanitizes handler exceptions before BullMQ stores them.
Plain errors produce `TRANSIENT_FAILURE`; `UnrecoverableError` produces a permanent
failure. Declare known, safe causes once in the same work definition:

```ts
failureReasons: {
  corrupted_file: {
    title: { en: 'The image file cannot be processed', ru: 'Не удалось обработать изображение' },
    nextStep: { en: 'Upload a valid image.', ru: 'Загрузите корректное изображение.' },
  },
}
```

A handler maps its known domain condition to
`throw new WorkFailure('corrupted_file', { permanent: true })`, importing
`WorkFailure` from the backend background-work public entry. Use `permanent: false`
for a recoverable condition such as unavailable storage. This declaration is
optional: unexpected errors, unregistered codes and missing historical reports
have an explicit generic explanation. An unrecognized code does **not** change
permanence. Never pass exception messages, provider responses, database text,
secret URLs or stack traces as codes or labels. No runtime interpolation is supported.

Codes are1–64 ASCII letters/digits/underscore/hyphen, at most16 own codes per work.
Title maps contain plain text up to80 characters per label; optional next-step maps
up to160. Each map requires English and permits at most8 locales. The catalogue
is at most8192 UTF-8 JSON bytes, and **each** complete diagnostic
`{code,title,nextStep?}` must fit1024 bytes. Registration validates and freezes a
snapshot, rejecting oversize entries before startup. These byte limits include
JSON escaping and Unicode; eight long translations need not fit. The existing
locale/region/English fallback displays the maps without a separate UI registry.
Keep code meanings stable; removing a code makes old reports fall back rather
than assigning their old identifier a new meaning.

Only the safe optional code is added to the existing current invocation report;
its512-byte summary and16-entry/8192-byte history caps stay unchanged. Readers
resolve a reason only for a current recorded failed invocation with matching
incarnation and invocation ID. Retry/new start, recycled IDs, stale reports and
trimmed history cannot borrow another attempt's cause. No extra execution table,
key or archive is created. Permanent retry refusal also uses the independent safe
Bull witness when the report is lost. Diagnostics never authorize commands or
prove external effect certainty. Provider-window preparation or ambiguous transport
without a recorded failure witness uses the generic explanation; unknown evidence
stays protected. Real notification and AI domain mappings are supplied by their
respective adapters.

The image recipe declares invalid-file and temporary-storage causes. It maps
business storage failure to the registered transient cause. Its reference-writing
fixture does not decode images; a downstream image handler must map its actual
decoder's known invalid-file condition. Unexpected post-commit failures still
replay under business idempotency rather than framework execution evidence.
The same backend recipe, error and resolver remain available when the optional
Console frontend is disabled; do not recreate Console UI to use them.

## Durable work: compiled database-owned recipe

Start with [db-owned-work.ts](../../apps/api/recipes/background-work/db-owned-work.ts)
and [its business tables](recipes/db-owned-work.sql). The example implements the
canonical `DurableWorkReader` and `DurableWorkControl` contracts and registers
their definition-owned DI tokens. No queue is required for its authority.
Copy this recipe under `apps/api/src/` and apply its SQL through a business
migration, as for ordinary work. Import its registration from the copied source
module; no frontend code or administrative controller is needed.

- `readSummary()`, `list()` and `detail()` return bounded safe domain projections
  and revisions. Do not fabricate broker measurements for database-owned work.
- `lock(ctx, command)` acquires business authority and target locks in a stable
  order using `ctx.tx`. It returns captured identity/revision snapshots.
- `eligibility(ctx, locked, command)` checks the locked business state. A stale
  incarnation/revision, active effect or exhausted grant refuses the action.
- `apply(ctx, locked, command)` writes only through `ctx.tx` and returns target
  outcomes. Durable incarnation identities may use any valid UUID (including UUIDv4);
  managed broker incarnations and queue epochs remain UUIDv7. Do not open another transaction or perform provider/network I/O.
  Business writes, command receipt and strict audit commit or roll back together.
- Business claims serialize against the same authority as pause and cancel.
  The recipe demonstrates finite automatic starts and one lifetime manual grant.

For a current failed business revision, use
`resolveWorkFailure(definition, row.failure_code)` in its common `WorkJob.failure`
projection. Store a safe code with the native failed-state/revision update in the
business transaction; clear it on retry/new start. The example's optional
`failure_code` column belongs to its business table, not generic execution evidence.
Do not derive a cause from administrative reasons, grants or absent records.

List rows fit2KiB **including** the1KiB diagnostic; details fit16KiB. Pages and
receipts fit128KiB; at most50 list rows consume100KiB before the envelope. Readers
check the actual encoded total. Raw Redis read aggregation has a separate512KiB
budget, not a public response allowance. Oversized data yields a bounded refusal;
reduce the approved projection instead of increasing limits.

The adapter owns business semantics and database migrations. Generic control owns
personal authorization, fresh authentication, confirmations, distributed budgets,
receipts, replay rules and audit. Register the adapter module in the registration's
`core` and `control` loaders; downstream code does not duplicate these surfaces.

## Limits and deployment

At most64 works and32 job/version bindings per work are accepted. The complete
registration catalogue fits64KiB of encoded JSON, including localized labels.
An oversized catalogue returns HTTP503 `WORK_UNAVAILABLE`; registrations are
never silently omitted. Ordinary job
commands require a supported bounded membership layout (at most4096 entries in
each inspected primary list). Queue pause/resume has no backlog-count ceiling:
a paused queue can keep receiving jobs and can still resume. Pausing affects new
claims; already active jobs may finish.

Diagnostics are live bounded windows, not an archive: first512 identities per
selected state/source, page size1–50, no arbitrary payload or recursive relation
expansion. The durable recipe clamps its last page to the remaining first512
identities. Its bounded513th-row witness sets `windowTruncated` only when more
than512 matching records exist; that witness is never projected. Provider evidence has an independent PG source that survives queue
hash removal; unavailable broker state is explicitly unobserved.

PG failure prevents new administrative effects and provider-window admissions.
Ordinary idempotent execution relies on its own business dependencies rather than
framework PG execution rows. Durable control uses PG business authority without
broker access; frontend session-vault failure can still prevent browser access.
The existing pre-auth rate limiter remains a separate abuse backstop; the following
PG budgets are shared across API replicas and do not fall back to local memory.

| PG budget                                   | Sustained rate         | Immediate burst |
| ------------------------------------------- | ---------------------- | --------------- |
| Command requests, global / per actor        | 100 / 10 per minute    | 10 / 3          |
| Target effects, global / per actor and work | 1,000 / 100 per minute | 100 / 50        |
| Pause/resume, per actor                     | 10 per minute          | 3               |
| Reads, global / per actor                   | 600 / 60 per minute    | 100 / 10        |

GCRA replenishes these budgets continuously; the burst is not an extra minute's
allowance. A batch has at most50 targets and a15-second elapsed dispatch budget.
At most4 ordinary control-client leases run concurrently. PG control transactions
have a3-second timeout, with1-second lock and statement limits. Rendering and
provider I/O do not hold those leases.
Temporary exhaustion of connection capacity returns `WORK_UNAVAILABLE` (HTTP503),
without increasing the cap or waiting in an unbounded queue. This says nothing
about job execution or provider effect certainty.

Deploy backend schema changes before starting producers and workers that depend
on them. Keep business deduplication records for the full period in which business
replay is permitted; stock queue history retention cannot provide that guarantee.

## Retained uncertainty and capacity

ADMIN intent/receipts and provider execution evidence have separate PG budgets.
The control ledger permits50,000 commands,250,000 targets and512MiB of counted
logical content. Provider-window evidence permits50,000 rows/64MiB globally,
10,000 rows/16MiB per work, and10,000 unresolved rows globally/2,000 per work.
These limits do not apply to automatic idempotent execution.

Active command/target reservations are capped globally at100/2,000, per actor at5/100,
and per work at10/200. Unresolved ADMIN targets have separate non-evicting caps:
1,000 globally,100 per actor and200 per work. Actor budget storage permits50,000
rows; inactive zero-reservation rows are eligible for bounded maintenance.

Known finalized receipts and definitive unfenced provider evidence are eligible
for removal after30 days. Unknown evidence, including operator-acknowledged
uncertainty, is retained. Compaction does not remove rows, refund unresolved
capacity, restore starts or create a manual grant. Old command free reason is
removed; its canonical fingerprint and original strict audit remain. A compact
snapshot retains its digest and the provider revision needed for settlement.

Protected compact rows reserve512 logical bytes. Counting uses bounded fixed-field
representations: UUIDs16 bytes, digests32 bytes, clocks8 bytes and integers4 bytes,
with explicit bounds for identifiers and state fields. Provider evidence retains
its existing columns and closed safe result; its maximum logical representation
is508 bytes, or512 with the legacy historical-start counter. This is not a512-byte JSON limit or a physical PostgreSQL storage
claim. Tuple headers, indexes, WAL, backups and the separate audit history require
additional storage. No archive table or automatic unknown eviction exists.

Worker maintenance runs every30 seconds within one elapsed1-second budget. A tick
processes at most100 expired targets,500 ledger targets,200 provider evidence rows
and500 inactive zero-reservation actor-budget rows. Expiration only settles
metadata: undispatched requests become not attempted; ambiguous dispatch becomes
unknown. It never dispatches a command. A failed transaction retains the previous
state for a later tick. Quota exhaustion refuses new effects while bounded reads,
existing finalization and uncertainty disposition remain available.

## Verify a registration

Run `pnpm test:background-work-contracts` with Docker available. The isolated
PostgreSQL/Redis lane exercises both compiled recipes through the common
registration and control surfaces, including two-worker image deduplication,
transactional durable mutation/receipt/audit and queued-email certainty gates.
It also checks process-role inventory, observation and read-only Bull Board.
No application database or owner preview is used. Keep downstream conformance
tests alongside the registered handler and business authority; do not add a
separate administrative API or UI to make a registration manageable.
