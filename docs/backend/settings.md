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

Reset passes `undefined` to the writer, stores `Prisma.DbNull` and advances
revision without deleting the row. Saving the baseline number is an explicit
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
reader can initialize from the restored state. An older binary cannot apply an
unsupported schema version; plan compatible rollback or restore separately.

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

For operator automation, obtain a fresh personal JWT through the normal auth
flow and keep it outside scripts/history. Substitute its variable below; the
example placeholder is not a credential. Consult development `/docs` for the
complete contract and error schemas.

```bash
curl --fail-with-body "$API_URL/api/v1/admin/runtime-settings/storage-probe" \
  -H "Authorization: Bearer $PERSONAL_ACCESS_TOKEN"
# Reread the current saved revision before each deliberate write.
curl --fail-with-body -X PATCH "$API_URL/api/v1/admin/runtime-settings/storage-probe" \
  -H "Authorization: Bearer $PERSONAL_ACCESS_TOKEN" -H 'Content-Type: application/json' \
  --data '{"intervalSeconds":60,"expectedRevision":0}'
# Reset after rereading revision; 1 here is only this example's next revision.
curl --fail-with-body -X PATCH "$API_URL/api/v1/admin/runtime-settings/storage-probe" \
  -H "Authorization: Bearer $PERSONAL_ACCESS_TOKEN" -H 'Content-Type: application/json' \
  --data '{"intervalSeconds":null,"expectedRevision":1}'
```

On conflict, reread and choose a new explicit write. After an ambiguous timeout,
reread before retrying; do not blindly replay. Reset uses each process's validated
env baseline (upstream 600 seconds). Align API/worker deployment baselines when
the same effective interval is required. The responding API's baseline is not a
worker or fleet acknowledgement. Redis session/rate failures can block admission
while existing readers and probes keep their last configuration.

## Extend the ordinary foundation

A downstream ordinary boolean definition follows the same contract:

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

Register it in `SETTING_DEFINITIONS`, seed its row in a migration, and add a
typed domain facade with authorization and language-agnostic shared contracts.
Choose domain bounds, failure/application behavior and a content-safe audit
projection explicitly. Subscribe a consumer before its first action and own its
application state independently of durable state. String, boolean and nullable
test-only definitions exercise this same writer, reader and codec in tests.

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
