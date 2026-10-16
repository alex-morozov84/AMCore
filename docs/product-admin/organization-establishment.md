# Create an organization and prepare its first administrator

Registration creates a personal account. It does not create an organization or
make a buyer an employee. An explicit organization creation assigns its creator
the organization `ADMIN` role. Trusted initial setup can instead assign a selected
verified account. Neither operation grants platform `SUPER_ADMIN`.

```text
Self-service: personal account -> explicit create -> organization ADMIN -> team
Initial setup: prepare USER -> recipient proves mailbox -> select verified ID -> organization ADMIN
Shop buyer: personal registration -> buyer account -> no staff membership
First platform SUPER_ADMIN -> separate trusted procedure -> optional Console
```

## Choose deployment policies

Both settings belong to the API environment. Restart or roll out every API replica
with consistent values. Hiding a button or changing only a command's environment
does not change the policy on another replica.

| Public signup | Self-service creation | Supported use                                                     |
| ------------- | --------------------- | ----------------------------------------------------------------- |
| `true`        | `true`                | Public service: people register, then explicitly create companies |
| `true`        | `false`               | Shop: buyers register; employees join its internal organization   |
| `false`       | `true`                | Existing or invited accounts can create companies                 |
| `false`       | `false`               | Closed installation with trusted initial setup                    |

`AUTH_PUBLIC_SIGNUP_ENABLED` and `ORG_SELF_SERVICE_CREATION_ENABLED` both default
to `true`. Creation admission preserves ordinary bearer JWT behavior; self-service
does not add email verification, recent authentication or a live-session requirement.
Trusted initial setup requires verified email and self-service creation disabled.

For the reference Compose deployment, set these values in the project's `.env`
file, or select a deployment file with `docker compose --env-file <file>`.
The common backend environment forwards both settings to API and worker containers.
The production setup command uses the same `api` service environment.
Apply a changed policy to every API replica before beginning initial setup.

## Deployment prerequisites

The deployment administrator applies migrations, initializes canonical system roles,
deploys matching code and schema, and configures mail, Redis and the public frontend
URL. The initial-setup command itself needs only the database configuration and
creation policy. It does not start the API, workers or listeners.

Use the CLI-capable **migrator** image for migration and seed. Use the **runner**
image for organization setup. The runner contains compiled commands and runtime
dependencies; it does not contain pnpm, tsx or the Prisma migration CLI.

For the reference Compose deployment, set `ORG_SELF_SERVICE_CREATION_ENABLED=false`
in `.env` first. With its owned infrastructure already running:

```sh
docker compose run --rm --no-deps migrate
docker compose run --rm --no-deps --workdir /app --entrypoint pnpm migrate --filter api db:seed
docker compose run --rm --no-deps api node dist/cli/organization-setup.js status
```

Use the same Compose files and `--env-file` option for every command if your
deployment selects them explicitly. The one-off setup command reads the configured
policy but does not change already-running API containers. Recreate all API replicas
with the same policy through the normal rollout before allowing user traffic.

Seed also initializes the AI catalogue. Run migrations and guarded seed under the
deployment's normal maintenance discipline. Seed refuses changed system templates;
it does not repair installed permissions. Investigate drift and use a controlled
migration. See [deployment](../operations/deployment.md).

The runtime database role needs DML access to the new result tables and permission
to lock `core.organizations` in `SHARE ROW EXCLUSIVE` mode. PostgreSQL permits that
mode with `UPDATE` or `DELETE` privilege. Initial setup uses a short transaction;
the ordinary Console operator does not stop writers or confirm a maintenance box.
Read-only status is not a complete database privilege probe. A setup attempt with
insufficient database privileges returns `SETUP_NOT_READY`. Ask the deployment
administrator to correct the runtime role; setup never grants database privileges.

## One shop with an internal organization

Prerequisites: migrations and guarded seed complete; self-service creation is
`false`; choose the intended first employee. Buyer registration may remain `true`.

1. Prepare that employee's ordinary account with the command below or the Console panel.
2. Let the employee confirm their mailbox through normal recovery or verification.
3. Create the initial organization for the verified account.
4. Store the returned immutable organization ID in your server-owned shop composition.
5. Mount team administration for that ID and check current membership on the server.

The employee becomes organization `ADMIN`. Buyers receive no staff rights. Your
shop can omit company headings, organization selection and all-organizations links.
Do not select the first membership or accept a browser-supplied organization ID.
Use the [fixed-organization integration recipe](integration.md).

Recovery: inspect initial setup status. An existing completion remains closed after
organization, account or grant deletion. Investigate the original identities;
repeating setup does not restore them. Never clear its completion marker to retry.

## Service with self-service companies

Prerequisites: initialize canonical roles and enable self-service creation. Enable
public signup if new people should register without invitations.

1. Register or sign in to a personal account.
2. Open **Organizations**, then **Create organization**.
3. Enter a name. Optionally enter a lowercase Latin short identifier.
4. Submit and wait for confirmation. Open the created organization's team pages.

One membership normally opens automatically. **All organizations** opens the explicit
list where another organization can be created. An unresolved creation takes priority
over automatic opening. Cyrillic and emoji names receive a valid generated identifier.

The creator receives `ADMIN` only in the new organization. If the response is lost,
choose **Check result** or **Repeat same request**. Keep the original operation ID and
input. A missing result does not prove an in-flight request cannot still commit.
Do not create a new operation merely because a response timed out.

If an explicit identifier is already occupied, the form asks for another identifier
and keeps the entered values. Cancel closes the form and clears that rejected
request's error. Reopening starts an empty form. This does not discard an uncertain
operation: use the recovery controls above when the result is unknown.

Recovery details stay in this tab's session storage without credentials. A different
account/session retires them. A closed tab, another device or denied storage may lose
the recovery ID. Direct clients must retain it themselves. Confirmed creation with
unavailable current access is a recovery state, not a rolled-back creation.

## Closed signup and the first organization ADMIN

Prerequisites: no organization or prior initial completion; both policies `false`;
roles initialized; mail delivery and normal recovery pages available.

```sh
pnpm --filter api organization:setup -- prepare-account --email anna@example.test --locale en
```

A new account has no password, no session, no membership and system role `USER`.
An existing account remains unchanged, including password, login methods, locale
and roles. The result returns its current `userId`, verification state and next
action. `existing` does not prove which earlier operation created that account.

1. Ask Anna to open the product's **Forgot password** page.
2. Anna receives the normal recovery email and opens its link.
3. Anna chooses a password. The normal reset verifies mailbox control.
4. Refresh the selected account and confirm that Anna is the intended employee.
5. Complete setup for that verified ID.

```sh
pnpm --filter api organization:setup -- bootstrap --name 'Example shop' --slug example-shop --admin-user-id '<verified-user-id>'
pnpm --filter api organization:setup -- status
pnpm --filter api organization:setup -- account-status --user-id '<verified-user-id>'
```

Anna can sign in and manage the organization's team. Existing verified accounts
can use normal sign-in. Existing OAuth accounts keep their login method; normal
verification can supply mailbox proof without a forced password reset.
Mailbox control does not prove employment. The trusted operator selects the employee.

## Installation without Console

Use the same prerequisites and recipient journey. Run the compiled commands in the
deployed runner, without installing development dependencies:

```sh
node dist/cli/organization-setup.js prepare-account --email anna@example.test --locale en
node dist/cli/organization-setup.js bootstrap --name 'Example shop' --slug example-shop --admin-user-id '<verified-user-id>'
node dist/cli/organization-setup.js status
node dist/cli/organization-setup.js account-status --user-id '<verified-user-id>'
```

Supply deployment-managed environment configuration. There is no fallback datasource
and no database URL/password argument. Production uses the API's TLS requirement.
No command accepts a password, verification override or platform role. `--locale`
defaults to the project's base locale. Output never contains a password or recovery
link. CLI account status omits the email address.

| Exit | Meaning                                                                     | Next action                                  |
| ---- | --------------------------------------------------------------------------- | -------------------------------------------- |
| `0`  | Status or operation completed; exact repeats can report `already_completed` | Inspect current status and access            |
| `2`  | Invalid command or configuration; no mutation started                       | Correct flags/environment                    |
| `3`  | Rejected prerequisite, closed state, changed result or different intent     | Investigate the reported condition           |
| `4`  | Database unavailable, busy or completion unconfirmed                        | Read status; repeat only the original intent |

The protected initial-setup API also remains when Console is removed. It requires
an existing live `SUPER_ADMIN` session. Use the CLI when that platform trust has not
yet been established. See the API reference below.

<!-- AMCORE_CONSOLE_ESTABLISHMENT_START -->

## Use Console after trusted platform access

Prerequisites: the first platform `SUPER_ADMIN` already has access through the
[separate trusted procedure](../auth/rbac.md#administering-super_admin).
Select **Organizations** in the left navigation, then find **First organization** above the search field.
The form shows three steps: **Administrator → Organization → Confirmation**.

1. Under **Who will manage the organization?**, enter the employee's email and select
   **Continue**. The application uses their existing account or creates one without a password or staff rights.
2. If the email is already confirmed, the next step explains that confirmation does not need repeating.
   Otherwise, ask the employee to select **Forgot password?** on the sign-in page and choose a password through
   the email link. This form does not send that email. Select **Check email confirmation**, then **Continue**.
3. Under **What is the organization called?**, enter its name and unique identifier. Select **Continue**.
4. Under **Is everything correct?**, check the organization and administrator together. **Back** preserves
   entered details. **Create organization** creates the organization and assigns its administrator.
5. **Organization created** shows the first administrator, explains how they can sign in, and offers
   **Open organization** for the Console operator. Reloading retains this result instead of reopening the form.

If the application is not ready, the page explains what the deployment administrator must finish.
An existing organization instead points to the inventory; it does not ask the operator to repair deployment.
The first administrator receives `ADMIN` only in this organization, never platform `SUPER_ADMIN`.

Console uses the same operations as the command. Mutations require recent
authentication and may ask for step-up. The operator receives no automatic company
membership. Completed or ineligible installations show status and recovery guidance.
They cannot prepare more accounts through setup.

A reload first reads server status and restores the current editable step in the same tab/session.
An unfinished request takes precedence over step navigation. A lost preparation response can be resolved by
repeating the same email only while eligible. A lost completion response preserves
the original company/recipient intent. A changed operator/session retires the draft.
This panel handles only initial installation. Repeatable provisioning of additional
organizations and invitations to their first administrators is a separate workflow.
If a selected account disappears, Console explains that it is unavailable.
Reload keeps that original selection until you choose **Change recipient**.
Organization details remain saved. Select the intended account and check its
mailbox confirmation again before continuing.
<!-- AMCORE_CONSOLE_ESTABLISHMENT_END -->

## State and recovery reference

| Server state                   | Meaning and permitted action                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| `eligible-empty`               | No completion or organization; prerequisites ready; prepare/complete allowed                |
| `not-ready`                    | Deployment policy, schema or templates need attention; status only                          |
| `existing-org-without-receipt` | An organization already exists; setup cannot adopt it or prepare accounts                   |
| `completed-intact`             | Original account, organization, membership and ADMIN grant remain; status/exact replay only |
| `completed-changed`            | Completion remains, but original identity or access changed; investigate without recreation |
| `unavailable`                  | The server cannot determine state; no eligibility may be inferred                           |

Preparation and completion serialize with competing initial setup. If preparation
wins first, its ordinary account may remain when another recipient is selected.
If completion wins first, queued preparation refuses. No automatic account deletion,
recipient substitution, permission repair or grant restoration occurs.

| Problem                                                       | Recovery                                                                                                                                                   |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Misspelled email                                              | While eligible, deliberately choose the correct recipient; the typo account remains ordinary                                                               |
| No email                                                      | Check spam, sender/provider configuration and public frontend URL; request a fresh normal link                                                             |
| Expired/used link                                             | Request a new link; wait for actual verification before granting access                                                                                    |
| Redis/auth outage                                             | Restore the existing login/recovery prerequisites; do not bypass verification                                                                              |
| Preparation reply lost                                        | Read installation status first; only an eligible installation permits the same-email repeat                                                                |
| Completion reply lost                                         | Read status, then repeat the exact original name/slug/user ID if needed                                                                                    |
| Busy operation                                                | Respect `Retry-After`, then read status; ordinary operators do not stop database writers                                                                   |
| Selected account deleted before completion                    | While setup is still open and no request has an unknown result, deliberately select another verified user ID and keep the company details for that request |
| Account, organization or ADMIN grant deleted after completion | Inspect the retained original IDs; exact replay reports changed state and never restores them                                                              |

The short database lock protects initial check-and-create. It does not permanently
enforce a one-organization database. A stale replica with creation still enabled
can create a different company after setup commits. Align deployment policy first.

An account created later with the same email is a different identity; setup never
selects it automatically. If completion has an unknown result, check that result
first. Closed or completed setup never replaces the recipient or restores access.

## API and headless integration

Self-service `POST /organizations` retains `{name,slug?}`, personal bearer admission
and `201 OrgResponse`. Send optional `X-Organization-Creation-Id: <UUIDv4>` to make
same-actor, same-input retries recoverable. Legacy clients without the header retain
non-deduplicated creation. Unknown body fields remain stripped and never grant authority.

`GET /organizations/creation-policy` returns the independent policy.
`GET /organizations/creation-results/:operationId` returns
`{organizationId,completedAt}` only for the originating actor with original access.
These private responses use `no-store`. Disabled policy blocks POST, including
replays, while result reads remain available.

Changed input returns `409 ORGANIZATION_CREATION_INTENT_MISMATCH`; changed original
access returns `409 ORGANIZATION_CREATION_RESULT_CHANGED`. Neither repairs access.
Explicit identifier collisions return `409 CONFLICT`. Unknown completion returns
`503 ORGANIZATION_CREATION_UNCONFIRMED`. See `/docs` for complete schemas and errors.

The initial-only protected API lives under `/admin/organization-establishment`:
`GET status`, `POST accounts/prepare`, `GET accounts/:userId/status`, `POST bootstrap`.
All require live `SUPER_ADMIN` bearer admission; writes additionally require recent
authentication. Account lookup after completion is restricted to its original user ID.
API keys cannot use these or the self-service creation handlers.

Product browser clients use the typed `/api/product-access/organizations` routes
and `useOrganizationCreation` from the public organization-context entity.
Pass the admitted actor/binding. Preserve frozen attempts and retire late callbacks
on identity changes. The headless contract has no ready UI, Console or router dependency.

## Permanent completion records

Successful identified creates and initial setup retain small permanent SQL result
records. They hold original IDs, a canonical input hash, version and completion time.
They do not contain raw company input, email, password, tokens or a cached response.
They survive account/organization deletion and have no expiry or cascading relations.

These are pseudonymous security metadata, not anonymous data. Include their retention
and backups in your downstream privacy policy. Routine erasure must not silently
reopen setup or allow an old operation to grant access again. Exceptional deletion
of completion history is outside ordinary recovery. This domain mechanism is separate
from the optional [Redis HTTP response cache](../operations/idempotency.md).
