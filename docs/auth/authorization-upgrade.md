# Upgrading organization authorization

Use this procedure when an installed AMCore database still has the legacy
ADMIN model-management grants and MEMBER/VIEWER wildcard grants. Current defaults
use explicit resources/fields and separate full `TeamAccess` authority. New resources
receive no automatic access. The change deliberately narrows ordinary and integration
rights; no API key is automatically enlarged.

This is an operator-controlled data upgrade, not an application-startup repair.
Choose the database explicitly, obtain its operator's approval, take a restorable
backup and rehearse on an isolated clone first. Implementation/test approval does
not authorize migration of a running installation.

## Audit before changing data

Run with an explicitly selected direct `DATABASE_URL`, a read-only database role
with SELECT on the core authorization tables, and psql. Do not source an unrelated
`.env` or start Nest/queues to obtain the report:

```sh
psql "$DATABASE_URL" -X --no-psqlrc --quiet --set=ON_ERROR_STOP=1 --set=FETCH_COUNT=200 --tuples-only --no-align --file=scripts/authorization-audit.sql
```

The script uses REPEATABLE READ READ ONLY, a 30-second statement timeout and
2-second lock timeout. It emits NDJSON reportVersion 2: a header, findings,
organization/member structural candidates, affected old key IDs and a complete
footer. FETCH_COUNT batches rows. Accept a report only when psql exits zero AND
its final record is the complete footer; errors may leave partial output.
IDs and reason codes are reported, not emails, names, condition bodies, key hashes,
short tokens, credentials or connection strings.

`templateState` is `clean`, `legacy`, `v2` or `unsupported`. Canonical legacy has
three unique global system templates, seven permission rows and eight template
links. Current v2 has six explicit permissions and eleven links. The audit also
reports unsupported positive wildcard links, invalid rule shapes, reserved-ID
collisions, ambiguous templates, limited organization managers and missing seeded
admins. Memberful organizations with zero structural TeamAccess candidates are
lockouts; zero-member organizations are reported separately.

On exact legacy templates the report predicts template replacement. A custom
`manage:Organization` role is never predicted as a full team administrator merely
because of that grant. DENYs on TeamAccess/Role/Permission/User/all veto full team
trust; Organization DENYs restrict org data independently.

Structural candidate counts are an **upper bound**. SQL cannot prove native CASL
parser validity or interpolation for arbitrary stored rules. On the upgraded clone,
run actual new-version admission with the complete owner payload and intended
credentials for at least one verified administrator per memberful organization.
A positive SQL count is insufficient. Keep the last seeded ADMIN invariant separate
from TeamAccess eligibility. Unsupported state or new lockout blocks cutover until
an explicit reviewed repair passes both the report and runtime probes.

## Supported migration inputs

`20260927180000_explicit_org_authorization_defaults` accepts only:

- Clean databases without builtin templates: no grants are created by migration;
  the guarded seed initializes them afterward.
- Exact canonical legacy templates: replace only their permission links with
  explicit defaults, preserving role/membership identities.
- Exact current v2 templates: validate and leave grants/ACL versions unchanged.

Partial/mixed seeds, duplicates, modified templates, reserved permission collisions
and positive wildcard custom-role links abort before changes. Do not guess which
ADMIN row is correct, silently expand wildcards or promote limited managers.
Resolve custom positive-all grants into deliberately reviewed concrete subjects;
future subjects remain denied. Retain wildcard DENYs.

The SQL runs in one transaction with 5-second lock and 60-second statement timeouts,
locks authorization tables in a fixed order, then holds the builtin writer advisory
lock. Every organization whose members hold a changed builtin role is identified
under those locks and gets one `aclVersion` increment in the same transaction.
Only obsolete permission rows with no remaining role references are removed.
Other concrete custom permissions, members, invitations and key identities/scopes
remain intact. Any failure rolls back rules, links and versions together.

## Maintenance and cutover

1. Review the complete clone audit, intended concrete grants, keys requiring
   replacement, and recovery plan. Rehearse migration, seed, runtime admission,
   rollback failures and lock behavior on that clone. Verify backup restoration.
2. Pause application traffic and drain **all** old API processes, in-flight requests
   and ACL writers before the data change. Mixed old/new authorization versions
   are unsupported. Select and verify the direct migration target explicitly.
3. Run the existing one-shot `pnpm --filter api db:migrate:prod` (`prisma migrate
deploy`) using the selected operator connection. Never use migrate dev/db push
   or run installed-policy rewriting on application startup. Inspect Prisma's
   displayed target and migration status. Clear unrelated test URL overrides.
4. Run the report again; check current signatures, all affected ACL increments and
   the intended administrators. Start only the new API version, probe actual
   JWT/key behavior, then reopen traffic.

Seed (`pnpm --filter api db:seed`) is for a clean install or exact-v2 verification.
It serializes with migration/other seeds, creates all defaults atomically, and
fails on legacy/partial/ambiguous installations with migration/recovery guidance.
Rerunning seed is not an installed-policy upgrade strategy. AI catalogue seeding
is separate from authorization initialization.

Old `manage:Organization` keys lose role/member/invite administration. Intentionally
issue a replacement key with exact `manage:TeamAccess` to an eligible owner, update
the integration, verify it, then revoke the old key. TeamAccess-only scope does not
authorize org deletion: delete also requires a matching Organization scope and owner
row-wide delete grant. Invite list/revoke remain JWT-only. Reading org details by
key needs permission for the actual record and all six response fields; partial
response grants return 403 instead of a redacted response.

No Redis scan or flush is needed: changed policies bump all affected versions and
every factory consumption normalizes rules. The [freshness provenance and one-hour
historical-cache caveat](rbac.md#deployment-and-rollback) still applies.

If a migration fails, first verify transaction rollback and inspect the Prisma
migration ledger against actual data. Only after confirming this exact failed
migration rolled back, mark it rolled back on the explicitly selected target:

```sh
pnpm --filter api exec prisma migrate resolve --rolled-back 20260927180000_explicit_org_authorization_defaults
```

Then correct the diagnosed precondition and retry deploy. Never mark incomplete
writes applied or edit an older migration/checksum to bypass the gate.

## Recovering a locked-out organization

Keep traffic/writers paused. Recovery requires an explicitly approved DB target and
reviewed member/org/role/link IDs. It is an offline transaction, not an automatic
endpoint or a broad grant based on a display name.

Prepare a transaction that:

- Acquires `pg_advisory_xact_lock(hashtext('org:last-admin:' || organization_id))`
  (the existing last-admin lock), locks the organization and verified member,
  checks the member still belongs to that organization, and validates the unique
  global seeded ADMIN template.
- Removes only specifically reviewed restrictive **MemberRole links** for that
  member, preserving their role/permission definitions and other members. Retains
  at least one seeded ADMIN membership. If needed, attaches the verified ADMIN
  template or a reviewed exact unrestricted custom TeamAccess role; never promotes
  every organization manager or changes the user's platform role.
- Increments the organization's ACL version once in the same transaction. Any
  failed identity/count/precondition assertion rolls back the whole repair.

If the shared ADMIN template itself is noncanonical, prepare a separate reviewed
shared-template repair and bump every affected organization transactionally.
Malformed rules need an explicit fix; hiding them with scopes does not repair them.
Do not use findFirst, remove all restrictive roles globally, invent members or grant
`manage:all`. There is no automated destructive rescue script.

Rerun the complete audit and actual new-version administrator admission on the
clone, then on the approved installation before reopening traffic. Keep the IDs,
changed links and before/after versions in the operator's recovery record.

## Rollback limits

A code-only downgrade is unsupported: old handlers/templates lack the new authority
separation and safe defaults. Prefer a reviewed forward fix. Restoring a reviewed
backup is an explicit operator decision under maintenance; it can lose writes since
that backup and needs migration-ledger reconciliation with actual restored state.
No automatic down migration or unilateral rollback is supplied.
