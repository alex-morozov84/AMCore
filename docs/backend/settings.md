# Runtime settings

The retained backend settings foundation stores ordinary, code-defined platform
configuration. Its first setting is `storage.probe.intervalSeconds`; adding an
example to this guide does not enable another production setting. Environment
configuration still supplies deployment prerequisites and the validated baseline.

## Definition and persistence

`infrastructure/settings` owns definitions, registry, codec, repository, writer
and one background reader per process. A `SettingDefinition<T>` declares the
stable key, positive SQL-integer schema version, strict Zod value schema,
validated baseline, platform scope, ordinary storage kind, safe audit target and
projection, and failure policy. Registry registration is code-owned; callers
cannot create keys through HTTP. The typed definition is used for reads and writes.

`core.platform_settings` has one JSONB envelope per key, with revision and update
time. SQL NULL means no override; `{ "value": null }` is an explicit null only
when the definition permits it. Primitive strings, booleans, numbers and bounded
JSON objects/arrays use the same machinery. Dates, nonfinite numbers and other
non-JSON values are rejected. The codec limits serialized UTF-8 envelopes to
16 KiB; SQL independently bounds `jsonb::text` bytes, whose formatting can make
the database limit stricter. Definitions should use smaller domain limits.

Migrations seed required keys with SQL NULL and revision zero. A missing row or
unsupported known schema version fails the authoritative read; GET never creates
or repairs data. Unknown keys survive older binaries and are not activated.
Changing schemaVersion requires an explicit migration and rollout design.

`SettingWriter.write(definition, value, expectedRevision, actor)` is internal.
The calling domain facade must authorize the actor and target. It locks the row,
checks the exact revision, and commits the change with its safe audit event in
the same transaction. Audit failure rolls back the change. A stale revision
conflicts even if its proposed value would be a no-op. A matching no-op changes
neither revision nor audit. Real changes increment revision; exhaustion fails.

Reset passes `undefined` to the writer and stores `Prisma.DbNull`, advancing
revision on a real change without deleting the row. Saving the baseline number is an explicit
override. Restoring a previous value is a new compare-and-set write; never rewind
revision or delete a row to reset it.

## Runtime reconciliation

API and worker each read the primary database at startup and every 30 seconds.
Consumers read immutable local snapshots, with no database or Redis query on a
storage probe, Overview observation or metrics scrape. This bounded loop is about
two reads per minute per process for the current key; no redundant Redis cache
or Pub/Sub dependency is needed.

Refresh uses transaction maxWait 1000 ms, transaction timeout 3500 ms, local SQL
statement timeout 2500 ms, and an outer 5000 ms caller deadline. The outer deadline
discards late results and keeps the underlying operation's exclusive slot until
it actually settles. Missed ticks reconcile promptly after settlement; they do
not accumulate queries. Results after shutdown are ignored.

Healthy adoption aims for 35 seconds, subject to a functioning database and event
loop. It is not a partition/pause SLA. Warm failures retain the last confirmed
value, source, revision and confirmation time. A cold failed read uses the env
baseline with unconfirmed authority and a null applied revision. This does not
promise startup when prerequisite Prisma/Redis initialization itself fails.
Confirmation older than 60 seconds is stale. Failed consumer application retries
the confirmed value without rolling back the committed write.

Lower revisions, or different data at the same revision, are integrity failures.
After restoring an older database backup, restart every API/worker process so its
reader can initialize from the restored state. See [rollout and recovery](#rollout-and-recovery)
for binary compatibility and recovery requirements.

Storage owns its timer. Numeric changes use the last actual probe start as their
anchor. Active I/O keeps its exclusive slot and schedules only after settlement,
using the latest interval. Unchanged numeric values do not postpone checks.
Storage-result staleness is three times the applied interval. Reading, saving or
resetting settings never runs a manual storage check.

## Operator API and rights

`GET /api/v1/admin/runtime-settings/storage-probe` reads authoritative saved
state and reports the responding API's baseline and local applied state. It is
`private, no-store`. `PATCH` accepts only an integer `intervalSeconds` from 30 to
3600, or null for reset, plus SQL-integer `expectedRevision`. A successful write
acknowledges durable saved state, not application by every process.

Both require a personal bearer JWT and current platform `SUPER_ADMIN`.
Organization-exchanged JWTs, API keys and organization roles cannot authorize
these operations. Writes additionally require fresh authentication and the
privileged mutation rate policy. An organization selector header is rejected.
The optional Console editor uses these same retained endpoints; removing the
administrative frontend leaves the backend, contracts, migration and reader.

### Read and interpret the response

Use the API origin in `API_URL` (for example, `https://api.example.com`, without
`/api/v1`) and a fresh personal JWT in `PERSONAL_ACCESS_TOKEN`. Obtain the token
through the normal auth flow; do not embed it in scripts, shell history or logs.
These Bash examples require `curl` and `jq`. Development `/docs` exposes the
complete OpenAPI contract; the optional Console uses its session BFF instead of
exposing this bearer token to browser JavaScript.

```bash
curl --fail-with-body "$API_URL/api/v1/admin/runtime-settings/storage-probe" \
  -H "Authorization: Bearer $PERSONAL_ACCESS_TOKEN"
```

| Field                                              | Meaning                                                                                             |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `saved.intervalSeconds`                            | Durable override, or null when no override is saved.                                                |
| `saved.revision`                                   | Current per-key CAS revision; use it for the next deliberate write.                                 |
| `baselineSeconds`                                  | Responding API's validated deployment baseline.                                                     |
| `applied.intervalSeconds`, `applied.revision`      | Responding API's local value and revision; revision is null before confirmation.                    |
| `applied.source`                                   | `override`, `baseline`, or `unconfirmed`.                                                           |
| `applied.lastConfirmedAt`, `applied.refreshStatus` | Last successful confirmation and `confirmed`, `unconfirmed`, `failed`, or `stale` authority status. |
| `applied.nextScheduledAt`                          | Next scheduled local probe, or null when no next timer is armed, including active I/O.              |

An HTTP 200 write certifies the durable commit. Saved and applied revisions may
differ while the reader catches up; the response does not acknowledge a worker
or fleet. Readers reconcile independently, even if the Console is absent.

### Save and reset deliberately

Run this as a Bash script with the two environment variables above. It rereads
rather than assuming an initial revision and stops if the read fails. This
example saves a 60-second override; saving 600 also creates an override.

```bash
set -eu
saved_state=$(curl --fail-with-body \
  "$API_URL/api/v1/admin/runtime-settings/storage-probe" \
  -H "Authorization: Bearer $PERSONAL_ACCESS_TOKEN")
expected_revision=$(printf '%s' "$saved_state" | jq -er '.saved.revision')
request_body=$(jq -cn --argjson revision "$expected_revision" \
  '{intervalSeconds:60,expectedRevision:$revision}')
curl --fail-with-body -X PATCH \
  "$API_URL/api/v1/admin/runtime-settings/storage-probe" \
  -H "Authorization: Bearer $PERSONAL_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' --data "$request_body"
```

Reset is an operator API operation, not a Console button. Run it only when the
intended result is each process's validated env baseline (upstream 600 seconds).
Reread immediately before reset; do not reuse the revision from the Save example:

```bash
set -eu
saved_state=$(curl --fail-with-body \
  "$API_URL/api/v1/admin/runtime-settings/storage-probe" \
  -H "Authorization: Bearer $PERSONAL_ACCESS_TOKEN")
expected_revision=$(printf '%s' "$saved_state" | jq -er '.saved.revision')
request_body=$(jq -cn --argjson revision "$expected_revision" \
  '{intervalSeconds:null,expectedRevision:$revision}')
curl --fail-with-body -X PATCH \
  "$API_URL/api/v1/admin/runtime-settings/storage-probe" \
  -H "Authorization: Bearer $PERSONAL_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' --data "$request_body"
```

Align API/worker deployment baselines if reset must produce one effective
interval. The responding API's baseline does not describe other processes.

| Response / symptom                        | Operator action                                                                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400                                       | Check the strict body, integer range and revision. Extra fields are rejected.                                                                     |
| 401 / 403                                 | Check personal authentication and the current platform role. For `STEP_UP_REQUIRED`, complete fresh authentication before a new deliberate write. |
| 409 `SETTING_REVISION_CONFLICT`           | Reread saved state and decide whether the proposed value is still intended. Never overwrite using a guessed revision.                             |
| 429                                       | Respect the privileged mutation rate limit; do not create a retry loop.                                                                           |
| 500 / 503 or an ambiguous network timeout | There is no success receipt. Reread before deciding on another write; a missing response alone does not prove that no commit occurred.            |
| Saved revision ahead of applied revision  | Check reader health and process-local application events; wait for reconciliation rather than triggering a probe.                                 |

Redis session/rate failures can block operator admission while existing database
readers and probes keep their last configuration. Storage observations can remain
available when the authoritative settings GET fails. For runtime diagnosis, use
the [storage runbook](../operations/runbooks/storage.md#interval-configuration).

## Rollout and recovery

The supported first deployment is a drained, all-process cutover: migrate, update
all API/worker/web consumers, verify reads and local application, then admit
settings writes. Follow the [deployment procedure](../operations/deployment.md#runtime-settings-rollout).
Pre-settings API/worker binaries have no reader and use env regardless of saved
overrides. Their API/web audit DTOs reject the new `RUNTIME_SETTING` target;
additive SQL persistence alone does not guarantee mixed-version compatibility.

Once settings audit events exist, direct rollback to a pre-settings release is
unsupported. Reset preserves prior audit events and can add another event; it is
not a compatibility repair. Prefer forward repair. A different rollback path
requires a tested compatible API/web/worker set and a backup/data-impact plan.
Preserve settings rows, audit history and migrations; do not delete audit events,
rewind revisions or use destructive migration reset as a workaround.

For settings-aware releases, a schema-version change requires an explicit data
migration, compatible decoding and a coordinated rollout/rollback plan. A reader
that cannot decode a known definition retains its last confirmed value, or uses
an unconfirmed baseline on cold start; an authoritative GET fails. Unknown keys
remain inert, which does not make unsupported versions of known keys compatible.

After a database restore, restart all API/worker readers to clear revision
regression protection and initialize from the restored state. Verify authoritative
GET, application events and Audit reads. A backup restore can lose settings,
audit events and other writes made after the backup; handle that data impact in
the [backup and restore procedure](../operations/backup-restore.md).

## Extend the ordinary foundation

A definition establishes a typed value contract, not a complete settings feature.
This illustrative boolean fragment uses the ordinary value engine; it deliberately
projects no before/after value into audit metadata. It is not a production key:

```ts
const example: SettingDefinition<boolean> = {
  key: 'example.enabled',
  schemaVersion: 1,
  schema: z.boolean(),
  scope: 'platform',
  storageKind: 'ordinary',
  baseline: () => false,
  auditTarget: 'example_flag',
  auditProjection: () => ({}),
  failurePolicy: 'retain-last-confirmed-or-baseline',
}
```

Use `z` from `zod` and `SettingDefinition` from the backend settings module's
`setting-definition.ts`. Before exposing another setting, complete these steps:

1. Register the definition in `SETTING_DEFINITIONS` and seed its versioned SQL NULL
   row through a migration. Choose strict domain bounds, a validated baseline and
   ordinary JSON limits. Do not activate an unknown persisted key through HTTP.
2. Add a typed domain facade and language-agnostic shared request/response schemas.
   The facade must authorize the actor and trusted target before calling the
   writer; the writer is not an authorization service. Preserve revision-checked
   writes and distinguish durable state from consumer application.
3. Complete the audit pipeline below before admitting writes. An empty
   `auditProjection` is not a useful value-change history and does not make the
   current interval-specific audit summary suitable for a boolean or string.
4. Subscribe the consumer before its first action and manage its applied state.
   `SettingsReader.subscribe` takes a synchronous `() => void` notification; read
   the immutable snapshot inside it. Synchronous application failures are retried.
   An async consumer must own completion/error handling: the reader does not await
   a returned promise or certify external side effects.
5. Prove type/bounds, reset versus explicit null, CAS/no-op/audit rollback,
   reconciliation failures and the consumer's application behavior. Verify actual
   Save/read/reset with multiple processes, and ensure optional UI removal retains
   the backend contract. Add use, configuration and recovery instructions.

`retain-last-confirmed-or-baseline` is the only implemented failure policy.
Do not assume it is suitable for every future permission or security-sensitive
value; a different failure contract needs an explicit design and implementation.
Per-key revisions do not provide an atomic snapshot across interdependent keys;
group values or design a coordinated contract when changes must take effect together.

### Complete the audit integration

The writer emits `admin.runtime_setting.changed` with `RUNTIME_SETTING` and the
reserved `settingKey`, `beforeRevision` and `afterRevision` fields. A definition's
projection must not overwrite these fields. The current sanitizer, shared summary
and Audit UI support the sole production storage interval. Other projection keys
are dropped unless explicitly allowed, and the current revision-based display
would incorrectly label another setting as a probe interval.

For each new domain, update the complete bounded path. The
[audit extension guide](../operations/audit-log.md#add-an-audited-action) describes
metadata sanitization and transactional audit requirements:

- `core/audit/audit-log.metadata.ts`: allow only its content-safe metadata fields
  for the action, with domain limits. Never expose arbitrary value JSON or secrets.
- `packages/shared/src/schemas/admin-audit.ts` and
  `core/admin/audit-projection.ts`: define and validate a typed safe summary;
  discriminate the setting/domain so storage-only fields do not imply its meaning.
- Console Audit rendering and locale catalogues: dispatch by that safe domain
  identity and provide accurate labels and baseline/reset semantics in each locale.
  Do not classify every pair of revision numbers as an interval change.
- Tests: exercise definition projection through persistence sanitization, API
  projection and localized display; assert the domain's correct before/after and
  reset summary, rejection of unapproved fields and absence of sensitive content.

The existing storage interval supplies the reference implementation. Adding only
a definition, row and facade is insufficient for an operator-facing new setting.

Platform and future organization settings may share the technical codec and
consistency primitives, but need separate rights and persistence. Organization
storage must have a real organization FK and trusted context-derived targeting;
platform privilege is not an organization membership grant. No organization
settings CRUD or implicit organization-over-platform inheritance exists here.

Secret definitions are rejected by ordinary registration. A future protected
resolver must separately decide vault/encrypted storage, external encryption
keys, replacement/revocation/rotation, least privilege, no-reveal responses and
cache lifetime. Masking an input is not protected storage. Never put raw secrets
in ordinary JSONB, DTOs, audit or logs, or repurpose the existing AI credential
allowlist/model catalogue as this settings registry.
