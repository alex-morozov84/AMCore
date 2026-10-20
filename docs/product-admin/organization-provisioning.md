# Create an organization and invite its first administrator

An operator with platform `SUPER_ADMIN` access can create an organization for another
person. The operator does not become a member. The recipient signs in or registers,
confirms their email and explicitly accepts the invitation. Only then do they receive
organization `ADMIN`. This does not grant platform `SUPER_ADMIN`.

```text
Organization details -> Administrator email -> Check details -> Create and invite
                                                                   |
                      Organization saved; invitation awaiting acceptance
                                                                   |
      Recipient: sign in/register -> verify email -> accept -> organization ADMIN
```

## Before you start

Invitation languages follow the application's `SUPPORTED_LOCALES`. A single-language
installation offers only that language. API examples use `en`; replace it with the
configured language in a single-language fork. Omitted invitation language defaults
to that installation's `DEFAULT_LOCALE`.

Apply migrations and initialize the canonical system roles through the guarded
[deployment procedure](../operations/deployment.md#seeding). Deploy matching code
and schema. Configure Redis, direct email and the public product URL. A deployment
administrator must already have established the first platform `SUPER_ADMIN` using
the [trusted access procedure](../auth/rbac.md#administering-super_admin). Provisioning
does not create that trusted platform access or repair permissions.

In production, set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` and
`FRONTEND_URL`. Use a verified sender and the public product origin for invitation
links, including when Console has a separate hostname. Never use the Console origin
for the recipient link. The reference Compose forwards these settings to API and
worker services. Apply changes consistently to every API replica.

```sh
docker compose run --rm migrate
docker compose up -d --build worker
docker compose up -d --build api web
```

These commands apply migrations and start matching containers, workers first. They do not seed
roles or establish the first platform administrator. Follow the deployment guide
for a fresh installation; ordinary rollouts must not run seed as a repair command.

`EMAIL_PROVIDER` still defaults to `mock`. With `NODE_ENV=production`, operator provisioning refuses
new create/reissue/replace requests before saving changes when email is mocked.
Existing results, reads, exact committed replay and cancellation remain available.
Development/test mock is allowed and clearly labelled. Provider configuration is
not proof of delivery; a real provider can still fail after commit.

Public signup and self-service creation both retain their default `true` values.
They are independent of operator provisioning. Disabling Console removes its
frontend only; the protected backend API and product invitation pages remain.

<!-- AMCORE_CONSOLE_PROVISIONING_START -->

## Use Console

Open **Organizations** and choose **Create organization**. This path can create the first or a later organization.

1. Enter **Organization name**. Optionally enter **Short identifier**, such as
   `north-shop`. It identifies the organization in URLs; it is not an email address.
2. Enter **Administrator email** and choose **Invitation language** (`en` or `ru`). This names the
   invitation recipient. It does not prepare a password or verify their mailbox.
3. Check the organization, email and Administrator role. Select **Create and invite**.
   Complete the existing fresh-authentication prompt if needed.
4. Read **Organization created** in the confirmation dialog. Choose **Open organization
   and invitation** or return to the list. The organization’s name appears before its administrators.
   This page shows the recipient, invitation state and available actions.
5. Read the email notice. With real email delivery, ask the recipient to check their
   inbox and spam folder and complete the invitation journey. In email test mode no
   message is sent; repeating the invitation does not make email delivery work.
6. After the recipient accepts, choose **Check invitation acceptance**. It reads the
   latest state without sending an email. The result says whether acceptance is still pending,
   expired or completed and shows the check time. A failed read never confirms acceptance.

**Back** preserves input. **Close form** closes the unsent form and clears its old
error. **Clear entered details** asks before clearing an unsent draft. It never deletes
an organization or invitation and is unavailable for an unknown request. A busy identifier produces a readable error; choose another identifier.
An unknown result keeps the original request frozen. Use **Check request result** or
**Repeat the same request** before starting another organization.

Choose the invitation path by default, including for the first organization of a
shop. Use **Use an already verified account** in **First organization** only for
an eligible empty installation with self-service creation disabled, when you
intentionally want to assign an already verified account without an invitation.
That trusted path is documented in [initial setup](organization-establishment.md).
Do not perform both paths for the same intended organization.

Find saved organizations in the inventory. **Needs attention** shows ALL organizations
without an administrator or with unfinished managed administrator invitations.
Expired or pruned awaiting invitations remain visible. The result dialog belongs to
this action only; reload does not show a last-created organization card. Another
operator can use the server-owned list without the original browser.
See [administrator management](organization-administration.md) for additional
invitations, current administrators and explicit existing-member assignment.

For an unfinished invitation, use **Send a new invitation** for a mail problem,
**Change recipient** for a wrong address, or **Enter recipient** after recipient pruning.
**Cancel administrator invitation** requires confirmation and invalidates the old link.
After cancellation, use **Invite an administrator** for a new invitation in the same organization.

<!-- AMCORE_CONSOLE_PROVISIONING_END -->

## Help the recipient obtain access

The recipient uses the existing [invitation journey](invitations.md). They can use
their existing password or supported OAuth login. A new recipient can register
through their invitation even when public signup is closed. This does not open
public registration or overwrite an existing account's credentials.

An existing account receives mail in its preferred language. The selected invitation
language supplies the default for a new recipient.

An existing unverified account signs in with its existing credentials. On the
invitation page, select **Request another verification email**, open that
verification email, then return and select **I've verified my email**. Registration
sends verification for a new account. Existing-account login does not automatically
send another verification email. If the page expires, sign in and reopen the
original invitation. Direct clients request verification with
`POST /api/v1/auth/resend-verification`, `{"email":"anna@example.test"}`, then use
the verification link and inspect the invitation again. Its generic success reply
does not prove account existence or delivery. See
[verification](../auth/email-auth.md#email-verification).

Opening the email, signing in or confirming the mailbox alone does not join the organization. The
recipient reviews the invitation and explicitly accepts it. Then they can switch
to the organization and use its administration pages/API.

A defensive conflict occurs if that account is already a member without the required
ADMIN role. Invitation acceptance does not silently elevate it. The operator can
select the exact existing member and explicitly confirm administrator assignment,
or choose another recipient while the process is unfinished. An existing
ADMIN still explicitly accepts; the initial invitation records their existing grant without duplicating it.
Ordinary invitations keep their role-preserving `already_access` behavior.

For an OAuth-only recipient whose mailbox is still unverified, use the SAME
verification controls after OAuth sign-in. A password is not required. If the
provider's trusted email claim already verified the account, no extra verification
step appears. Do not create a replacement account just to verify its email.

The operator verifies current ADMIN in the organization's administrator list or
`GET /admin/organizations/:orgId/administration`. This proves current recorded
rights, not a successful request from the recipient's device. Ask the recipient
to sign in, switch organization and open its team page or call its authorized API.
The operator must not obtain or impersonate the recipient's token for that check.

## Recover without creating another organization

For direct API actions, use the [creation and recovery requests](#save-and-send-a-creation-request).
After cancellation or completion, use the separate
[administrator commands](organization-administration.md#use-the-backend-without-console).

| What happened                                 | What to do                                                                                  | Expected result                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| No confirmed email send                       | Check the recipient address, inbox/spam and provider configuration, then explicitly reissue | Same organization; a new invitation invalidates old links                                    |
| Wrong address                                 | Explicitly replace the recipient with the correct address                                   | Same organization; old invitation revoked; new recipient must accept                         |
| Invitation expired                            | Send a new invitation while its retained details are available                              | New validity period; old links stop working                                                  |
| Awaiting process; old recipient removed       | Explicitly choose the recipient again for the awaiting process                              | New invitation for this same awaiting process                                                |
| Cancelled process, including pruned recipient | Create a new administrator invitation with email, language and reason                       | NEW intent in the same organization; never resume the cancelled one                          |
| Lost response or reload                       | Check the original request reference; repeat the same frozen request if needed              | Original result; no duplicate organization or automatic resend                               |
| Another operator takes over                   | Read the current organization and invitation state using their saved IDs                    | Current state and permitted recovery; their explicit action uses a new request ID            |
| Process completed, then access removed        | Review the exact member and make a new explicit administrator assignment or invitation      | The original first-administrator process stays closed and does not restore the removed grant |
| Original organization deleted                 | Read the original result                                                                    | Unavailable organization; old request never recreates it                                     |

A provider acknowledgment means that the email service accepted the message. It
never proves inbox delivery. Timeout or error can occur after the service took
effect. An unconfirmed sending outcome does not mean that no email was sent.
The organization remains saved after a real-provider error. Repair configuration,
then explicitly reissue. There is no automatic secret-bearing email retry queue.

Cancelling the initial invitation closes it permanently and invalidates its old link.
The organization and its existing administrators remain. If no administrator exists,
create a separate administrator invitation or explicitly assign an existing member. It creates a NEW
operation and does not resume the cancelled process. Use reissue or recipient
replacement for a mail problem while the initial process is still unfinished.

After acceptance, removal of the account, membership or original ADMIN grant never
reopens the original process. Historical acceptance and current access are shown separately. A new
grant with the same role or an account with the same email is not the original grant.

## Installation without Console

All paths below are relative to `/api/v1`. Obtain a personal bearer session through
existing [email/password](../auth/email-auth.md) or [OAuth](../auth/oauth.md) login.
Writes require current `SUPER_ADMIN`, a live owned session and recent authentication.
API keys and organization ADMIN credentials cannot provision organizations.

### Refresh operator authentication

The deployment setting `STEP_UP_MAX_AGE_SECONDS` defaults to 600 seconds (10 minutes).
The server checks session authentication age again after relevant waits. A stale
write returns `403 STEP_UP_REQUIRED`. There is no dedicated freshness preflight;
a successful policy read does not prove that a later write is fresh. Keep the
saved operation ID/input while renewing authentication; never create a new command
just because authentication expired. Silent token refresh does not renew freshness.

For an account with a password, confirm the current password:

```http
POST /api/v1/auth/step-up
Authorization: Bearer <personal-super-admin-access-token>
Content-Type: application/json

{"password":"<test-current-password>"}
```

Use the returned `200 {"accessToken":"<new-personal-access-token>"}` for the
same command. This refreshes the current session; it does not rotate its refresh
cookie. Invalid credentials or a revoked session require their normal recovery.

OAuth-only accounts return `403 STEP_UP_METHOD_UNAVAILABLE` for password step-up.
A completed OAuth login creates a NEW session with a fresh local authentication
time. AMCore does not require the provider to ask for a password again or verify
its authentication age. Provider single sign-on may complete without a new password
prompt. This does not renew another client's old session.

Choose the client you will actually use:

- **Bundled product website:** normal OAuth sign-in creates a BFF browser session.
  It supplies neither a command-line bearer token nor a Console-disabled operator
  UI. Do not extract backend tokens from the browser/vault. This login alone is
  not a direct-API provisioning procedure.
- **Custom direct OAuth client:** implement the existing [callback and ticket
  exchange](../auth/oauth.md#exchanging-the-login-ticket). Start the provider login,
  preserve browser-bound cookies and own the callback at
  `{FRONTEND_URL}/{locale}/auth/callback`. AMCore has no per-client callback override.
  The bundled website already handles that route; a separate client must arrange
  deployment routing for its own handler, not intercept the website's tickets or
  change the shared `FRONTEND_URL` just for one operator. Send the ticket with its
  matching `refresh_token` cookie to
  `POST /auth/oauth/exchange` within 60 seconds. Use the returned `accessToken` for
  provisioning in that new personal session. Protect the callback/cookie jar;
  never copy tickets/cookies into shared terminal output or logs.
- **Personal password API client:** if the deployment permits password login,
  an OAuth-only account's owner can deliberately set a password using the existing
  [Forgot password / Reset password](../auth/email-auth.md#password-reset) email
  recovery. `POST /auth/forgot-password` takes `{"email":"operator@example.test"}`;
  the owner opens the mail link and supplies their chosen password. This works
  even without an old password, verifies the mailbox and revokes ALL existing
  sessions. It keeps the account's platform role and OAuth links. The owner then
  calls `POST /auth/login` with their email/password and uses its returned personal
  `accessToken`. Preserve the original operation ID/input across this new login.
  The operator chooses this additional login method; provisioning never sets it.

AMCore has no built-in password-login disable switch. “Permits password login”
means the downstream product and deployment policy allow this method.

AMCore has no standalone OAuth CLI login or BFF-token export. If policy requires
OAuth-only AND no direct OAuth client is configured, direct API provisioning is
not available to that operator yet. Configure that client or have another current,
properly authenticated SUPER_ADMIN perform authorized operations. Do not bypass
freshness with an API key, another person's token or raw database credentials.

### Save and send a creation request

Generate one UUIDv7 request ID and save it with the exact input before sending.
For the reference running API image, this prints a non-secret request ID:

```sh
docker compose exec -T api node --input-type=module -e 'import { createInvitationOperationId } from "@amcore/shared"; console.log(createInvitationOperationId())'
```

Inspect `GET /admin/organization-provisionings/policy`, then submit:

```http
POST /api/v1/admin/organization-provisionings
Authorization: Bearer <personal-super-admin-access-token>
Content-Type: application/json

{
  "operationId": "<saved-UUIDv7>",
  "name": "North shop",
  "slug": "north-shop",
  "firstAdminEmail": "anna@example.test",
  "inviteLocale": "en"
}
```

`201` returns `operationId`, `organizationId` and `createdAt`. It means creation
committed, not delivery or administrator access. Exact replay returns the same
receipt without another organization or email. Reusing its ID with changed input
or a different creator conflicts. Any admitted current operator may read creation
lookup, including an absent ID. Administrator-command receipts instead belong to
the originating actor; use current organization state for handover.

| Action                                 | Endpoint and input                                                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Recover creation                       | `GET /admin/organization-provisionings/operations/:operationId`                                                   |
| Read current state                     | `GET /admin/organizations/:orgId/provisioning`                                                                    |
| Reissue                                | `POST …/provisioning/reissue`: new `operationId`, `expectedRevision`, `expectedInviteId`, `expectedGeneration`    |
| Choose recipient, also after retention | `POST …/provisioning/replace-recipient`: new `operationId`, `expectedRevision`, `firstAdminEmail`, `inviteLocale` |
| End permanently                        | `POST …/provisioning/cancel`: new `operationId`, `expectedRevision`                                               |

Recovery writes return `200` with their operation ID, organization ID and resulting
revision. Read current progress afterward. Same-command replay is read-only;
a stale revision requires refreshing state before another deliberate action.
No privileged endpoint returns invitation tokens or recipient links.

[Response examples](organization-provisioning-responses.md) show exactly where
`revision`, `invite.id`, `invite.generation` and `aclVersion` are returned.
`GET /admin/organizations/:orgId/provisioning` reads current acceptance state;
it is not the accept/write endpoint.

Creation lookup and administrator-command lookup have different response schemas:

| Creation lookup response                                                                                                                       | Meaning and next step                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `{"state":"committed","receipt":{"operationId":"<saved-UUIDv7>","organizationId":"<organization-id>","createdAt":"2026-10-17T12:00:00.000Z"}}` | Creation saved; open current organization state                                                         |
| `{"state":"unrecorded","sameIdAdmissible":true}`                                                                                               | No saved result observed; preserve and retry the same ID/input, not a new creation                      |
| `{"state":"unrecorded","sameIdAdmissible":false}`                                                                                              | ID is more than 5 minutes in the future; investigate the clock and keep the original attempt unresolved |
| `{"state":"expired_unrecorded"}`                                                                                                               | Absent ID is older than 24 hours, checked under its lock; it can no longer start                        |

`unrecorded` does not prove rollback while another request may still commit.
Do not start a different create automatically. Only `expired_unrecorded` permits
explicitly retiring this absent expired request before a new deliberate creation.
Retiring means acknowledging the local recovery record, not cancelling server work.
A replacement operator may also start a new authorized creation after this result;
there is no server-side close command for an absent creation. The 24-hour age comes
from the UUIDv7 timestamp, compared with database time under the operation lock.
The administrator-operation equivalent is `{"state":"unknown","expiredUnrecorded":true}`;
`unknown` with false is not terminal proof. The future allowance is 5 minutes,
separate from the 24-hour maximum age; it is not 24 hours plus 5 minutes.

If the original operator is unavailable while creation remains `unrecorded`,
the replacement operator may only inspect that reference and current inventory.
They cannot replay another creator's write. Recheck until it commits or becomes
`expired_unrecorded` after the 24-hour admission window; do not create a duplicate
while waiting. If it commits, recover that organization with a new authorized
reissue/replacement command. An urgent takeover of an absent, still-admissible
creation is not a supported cancellation/transfer operation.

Share the non-secret operation reference with the authorized replacement operator.
It is saved before sending, in the API response and in the original browser's
recovery state. For an organization already found in inventory, its provisioning
status also returns `creationOperationId`. The replacement operator may inspect
the original creation result, but cannot execute creation under another creator's ID.
<!-- AMCORE_CONSOLE_PROVISIONING_SEARCH_START -->

Use the general **Search organizations** field to search name/identifier;
**Needs attention** has its own pagination and no search field. Clear unrelated
filters and distinguish a read error from no matches.
<!-- AMCORE_CONSOLE_PROVISIONING_SEARCH_END -->

If both the operation reference and the organization are unavailable, inventory
absence is not proof of rollback. Do not recreate automatically or choose a new ID
on that basis. Have authorized support reconcile the original request and audit.
The system cannot recover an exact forgotten operation ID from an email address.
Support should search the unfiltered inventory by the supplied name/identifier,
inspect any matching organization's `creationOperationId`, and have authorized
deployment staff correlate the initiating actor/time with persisted `org.created`
audit metadata. Do not paste recipient links, tokens or passwords into the case.
If the reference still cannot be established, keep the outcome unresolved: support
must explicitly reconcile the possible earlier creation before a new creation.
There is no automatic recovery key derived from email.
After reconciliation, a new organization is a separate explicit decision.

A fresh unknown UUIDv7 may be at most 24 hours old or at most 5 minutes ahead of
the server clock. These are separate past/future bounds.
Successful creation receipts do not expire. Recovery-command receipts last 30 days;
old unknown command IDs cannot start after their fresh-admission window.
`503 PROVISIONING_UNCONFIRMED` requires inspecting/replaying the original request.
`PROVISIONING_BUSY` is a known aborted attempt; respect `Retry-After`.
`PROVISIONING_ADMISSION_UNAVAILABLE` saved no domain changes, but Redis quota may
have been consumed. The full request/error contract is in `/docs`.

`GET /admin/organization-provisionings/policy` is a read-only readiness check:
`{"role":"ADMIN","mailMode":"mock","createAllowed":false}` in production mock.
It sends no email and consumes no mail quota. New sends return
`503 PROVISIONING_EMAIL_NOT_CONFIGURED`; the UI explains that email must be configured.
Provider mode with `createAllowed:true` is configuration readiness, not a network
or inbox-delivery test. There is no no-send end-to-end delivery probe.

The API limits sending to 3/hour per organization+recipient, 30/hour per operator+
organization and 30/hour per platform operator across original and additional
administrator invitations. HTTP mutation limits
also apply to replay and cancellation. Redis failure/deadline rejects admission;
late Redis replies cannot continue SQL writes. Later rollback does not refund quota.
On `429 RATE_LIMIT_EXCEEDED`, retain the organization/request and respect `Retry-After`
(the mail limiter returns 3600 seconds). Do not rotate recipients, actors or request
IDs to evade it. Read current state while waiting; reissue explicitly when allowed.
These counters expire one hour after the latest successful admission that touched
them, not at the next wall-clock hour. Other HTTP rate limits may give a different wait.

A downstream with the standard product frontend keeps the recipient pages when
Console is disabled. A custom frontend implements the existing scoped continuation,
login/register, verification, inspect and explicit accept APIs in the invitation
guide. After acceptance use `POST /organizations/:id/switch`, then an authorized
organization API such as `GET /organizations/:orgId/members` to verify working access.
The initial-setup CLI remains available; it does not create later organizations.

## Shop, closed CRM and SaaS recipes

- **Shop:** allow buyer signup if desired; disable self-service organization creation.
  The downstream developer/deployment operator records the immutable organization
  ID from the creation receipt in the server-owned shop composition. This can be
  configured before acceptance, but do not declare employee access ready until
  the invitation is accepted and current ADMIN is checked. Buyers have no staff membership.
  Hide company selection in your product UI; never select an arbitrary first organization.
  This is a downstream server composition, not a new Console setting or automatic
  environment option. Follow the [fixed-shop integration recipe](integration.md#fixed-internal-organization-for-a-shop)
  and replace its example server-owned `SHOP_ORGANIZATION_ID` with your saved ID.
  Trusted verified-account setup is an alternative only on an eligible empty installation.
- **Closed CRM:** disable public signup and self-service creation. The trusted operator
  creates the organization and invites its administrator. Invitation-bound registration
  remains available. Missing mail is repaired in that organization, not by opening signup.
- **SaaS:** configure signup and self-service independently. Anna uses the PRODUCT
  **Organizations** page, not the SUPER_ADMIN Operations Console.
  <!-- AMCORE_CONSOLE_PROVISIONING_URLS_START -->
  In the default path topology these are `/en/organizations` and
  `/en/admin/organizations` respectively. The ordinary account cannot use Console.
  <!-- AMCORE_CONSOLE_PROVISIONING_URLS_END -->
  Users can explicitly create
  their own companies if enabled; operators can separately create one for another person.
  Each deliberate new organization uses a new request ID; uncertain retries keep the old ID.
  Agree whether Anna or the operator will create the intended company before either
  submits. Self-service and operator creation are independent: their IDs do not deduplicate
  each other. Two successful separate requests create two organizations, even for one email.

## Retained facts and privacy

A permanent minimal provisioning record stores operation/organization/actor IDs,
a versioned fingerprint and original completion/grant IDs. It has no cascading
relations that could reopen creation after deletion. It stores no plaintext email,
organization name, raw link, token or rendered body. These IDs/fingerprints remain
pseudonymous data, not anonymous data. Normal backup/erasure policies must account for them.

An unaccepted, unrevoked invitation becomes eligible for address removal 30 days
AFTER its `expiresAt`, not 30 days after issue. Accepted invitations become eligible
30 days after acceptance; revoked invitations 30 days after revocation. The cleanup
job removes eligible rows later, so these are thresholds, not exact deletion times.
Pruning an awaiting invitation clears its current-recipient pointer. For an awaiting
process, choose the recipient again; for a cancelled process, create a NEW invitation.
Minimal historical completion remains closed. The browser keeps
an operator/session-bound recovery journal; on the next read, drafts older than 24 hours lose their details,
and an expired unresolved creation retains only its operation reference. An account
change clears the former journal from the next admitted UI. The same actor can recover
their input after fresh login, but old callbacks retire and every action uses current
server authority and the new session binding. Reload never submits automatically.
