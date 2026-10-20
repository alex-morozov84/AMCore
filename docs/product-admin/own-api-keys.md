# Manage your own API keys

Addresses below use default path placement. For a separate host or custom alias,
see [placement and sessions](placement-and-sessions.md).

Use **My API keys** to give your integration a personal, organization-bound key.
You must sign in. You can inspect and revoke your own keys after losing membership.
The first ready creation form requires current full team administration.
Other organization members can create their own keys through the bearer API or custom UI.
An administrator cannot issue a personal key for someone else.

## Create and save a key

1. Open **My API keys** in the sidebar, then select **Create key**.
2. Choose an organization in the form. The searchable select supports pages.
   Creating through this ready form requires current full team administration.
3. Enter a name. Select an expiry and the operations your integration needs.
   The default expiry is 30 days. Custom dates use the displayed browser time zone.
   A nonexistent local time or a past custom date is rejected.
4. Read the selected operations and their required dependencies.
   Updating an organization requires reading. Deleting an organization includes full team administration;
   the form shows and confirms this consequence. Existing owner restrictions still apply.
5. Select **Create key**. Save the secret in your integration's secret store.
   The adjacent copy icon checks your session again. Manual copying is offered only when
   the clipboard fails and the secret is visible. A session-check failure instead offers verification.
6. Select **I saved the key**. You cannot retrieve the secret again.

The result uses the actual response expiry, formatted in the browser time zone shown in the form.
Changing organization in an unfinished form preserves name and expiry but confirms clearing permissions.
Ordinary background checks preserve the mounted form and its values.

Scopes are `action:Subject` limits, not role assignments. The ready form reuses
catalogue presentation from Roles without the own/assigned/all role levels.
Additional requirements appear in the final scope set. Its limit is 64 distinct scopes.
Current owner permissions, record/field restrictions and DENYs still apply.
A later permission grant can activate an existing dormant scope.
See [scope semantics](../auth/api-keys.md#effective-permissions).

The inventory covers all your organizations in a compact table.
Name search, organization and status filters work together across the complete inventory.
Search is a literal case-insensitive substring of the name; it does not inspect secrets or IDs.
Filters reset the page; Refresh preserves filters. Reset clears filters and returns to page one.
The URL retains filters and pagination for reload and browser history.
The default is all organizations and all statuses, with 20 rows per page.
The table scrolls horizontally on narrow screens. Select a name to open its details.
**Unexpired** describes time, not successful authorization. Names are not unique.
Technical details label IDs and retain every original scope, including legacy values.
A current organization name appears only when you are a member at the read snapshot.
Otherwise **Organization name unavailable** appears; you can still filter and revoke your keys.
Inventory filters and the creation organization are independent. Changing a filter does not discard a creation result.

## Lost responses and secrets

Selecting Create freezes the submitted name, organization, expiry and permissions.
During the authority check, Cancel invalidates that submission. Reopening starts a separate draft.
After creation dispatch, dialog dismissal is blocked. Leaving the page can still
lose the result. A failed list refresh does not discard a confirmed secret.
Closing a confirmed result before saving requires explicit loss confirmation.

An unknown result means the key might exist. The form never repeats creation automatically.
Choose **View key list**. The result window closes so you can inspect the unfiltered list and its pages.
Reopen the creation result when ready. Inspect unwanted keys and revoke them deliberately.
A matching name, timestamp or scope set cannot prove which attempt created a row.
Loading the list confirms inspection only; it is not a creation receipt.
To make another key, acknowledge that the earlier key may exist, then choose
**Dismiss warning and start new creation**. This resets the draft without sending a request.

The unknown-result warning survives closing/reopening the dialog, filters, pagination,
target changes and visibility changes while the page host remains mounted.
It is not stored across reload or navigation. On a fresh page, inspect your keys
before replacing an unresolved attempt. When the created key ID is known, its lost-secret result offers targeted revocation. A lost secret requires revocation and a new key.
For planned replacement, create and test the new key before revoking the old one.
For compromise, revoke first. Revocation is permanent; admitted requests may finish.

## Session checks

The browser checks the cookie-session/actor binding on entry and before commands.
A confirmed creation needs a new matching probe before revealing its secret.
Copy requires another check. Refresh or step-up retains a binding; a new login changes it,
including another login by the same person.

Blur or a hidden tab removes plaintext from the DOM and disables copying.
The same read-only field displays a non-secret mask. Return to the tab to verify before restoring its transient secret.
A temporary probe failure keeps the confirmed result concealed and recoverable.
A missing or changed session clears prior actor state and offers Reload.
Changing the creation target or leaving the page discards the old plaintext. Inventory filters do not change that target.
A BFCache-restored page verifies again; discarded plaintext never returns.

While creation is pending or a secret is retained, a focused visible page samples
the session every five seconds after the previous check completes. Idle inventory
has no periodic session polling. This is sampled detection, not atomic cookie/DOM
or clipboard synchronization. Browser suspension and network delay extend detection.
The secret stays outside QueryCache, MutationCache, storage, URLs, server-rendered
props, logs, notifications and accessible labels. Local references are not secure memory erasure.

## Custom presentation

Application composition reads `readOwnApiKeyAdmission(await headers())` from
`@/entities/api-key/index.server`. Handle missing sessions with the normal login redirect.
Pass only `{binding, actorId}` and the target to the client. Keep the host keyed by binding.
Use the entity independently of the organization controller or ready widgets:

```tsx
const { controller, attempt, session } = useOwnApiKeyController(admission, organizationId)
const inventory = useOwnApiKeys(controller, { page: 1, limit: 20, status: 'all' })
const create = useCreateOwnApiKey(controller)
const revoke = useRevokeOwnApiKey(controller)
const revocation = useOwnKeyRevocation(controller)
const organizations = useOwnKeyOrganizations(controller, {
  purpose: 'creation',
  page: 1,
  limit: 20,
})
// An explicit user action calls create({name, organizationId, scopes, expiresAt}).
// It resolves after updating attempt; it does not return or cache the secret.
const secret = useOwnApiKeySecret(controller, organizationId)
```

Import these symbols from `@/entities/api-key`. The secret hook subscribes to the transient
result directly; do not memoize an imperative controller getter in a render. Render `secret` only in the active
local result. Use `controller.copy()` for a boolean outcome, or `copyDetailed()` to distinguish clipboard failure from an unverified session. Use `acknowledgeSaved()` to discard the secret.
Mirror ready pending, unknown inspection/acknowledgment, concealment and loss-confirmation
states. `controller.inspect()` loads All/page1; `dismissUnknown(true)` requires a completed
inspection. Closing or unmounting a preflight draft must call `closeDraft()`.
Pass an optional fresh authority check as the third argument of `controller.create(input, organizationName, verifyTarget)`.
The controller owns this cancellable preflight; do not await that check before capturing the submitted input.
Render translated errors with `ApiErrorAlert`; never render raw backend messages.
The raw hooks require no TeamAccess check, preserving ordinary MEMBER issuance.
Custom UI owns its fields, labels, validation and consequences.

The ready mount is `OwnApiKeysMount` from `@/_app/organization-access/index.server`.
Placement's optional `ownApiKeysPath` controls the personal navigation entry; omitting it omits that entry.
An explicitly composed application can place the page and its navigation in its own shell.
Physical settings routes remain application-owned; placement does not create them.

## Browser and API contracts

Dedicated routes use strict `{binding,data}` envelopes and no-store responses:

| Browser operation                     | Upstream                             | Browser success                           |
| ------------------------------------- | ------------------------------------ | ----------------------------------------- |
| GET `/api/own-api-keys`               | GET `/api/v1/api-keys`               | 200 inventory                             |
| POST `/api/own-api-keys`              | POST `/api/v1/api-keys`              | 201 one-time result                       |
| DELETE `/api/own-api-keys/:id`        | DELETE `/api/v1/api-keys/:id`        | 200 `{revoked:true}` after exact empty204 |
| GET `/api/own-api-keys/organizations` | GET `/api/v1/api-keys/organizations` | 200 bounded organization options          |
| GET `/api/own-api-keys/session`       | Vault and refresh only               | 200 `{verified:true}`                     |

Mutation routes require exact same-origin Origin. All require the expected binding
in `X-AMCore-Context-Session`; unsupported methods return405.
Dedicated bounds are 32KiB request, 256KiB upstream, 272KiB envelope and 2KiB query.
Commands use 15-second server and 20-second client deadlines; probes use five seconds
and a 2KiB envelope. Invalid acknowledgments are never treated as committed receipts.
The [direct bearer contract](../auth/api-keys.md#creating-an-api-key) retains its scope grammar,
no-expiry support and member issuance. These browser limits add no direct API quotas.
The generic `/api/api-keys` proxy remains compatible, including accepted aliases;
it does not gain this dedicated lifecycle or typed response validation.

## Organization options and revocation receipts

`useOwnKeyOrganizations` is independent of ready components and the organization controller.
The required purpose is `inventory` or `creation`. Each response has at most 20 page options
and one separately selected eligible option. Search covers current name and slug.
Creation includes all current memberships and a full-team-access hint; that hint is not issuance authority.
Inventory includes current memberships with owned keys and an anonymous unavailable bucket.
Selected options remain independent of option search and pagination. No former organization names are exposed.
Metadata uses a 32KiB response and 36KiB browser envelope; query limit is 2KiB.

`useOwnKeyRevocation` exposes a safe `idle`, `pending`, `confirmed`, `unknown` or `refused`
receipt with the target key ID. It survives list filters, row removal and refresh failures.
Only the exact validated deletion acknowledgment confirms that command.
A later GET, a missing row or a 404 does not prove an earlier unknown deletion succeeded.
A new deletion requires deliberate confirmation; commands never retry automatically.

A dispatched deletion finishes independently of the creation organization and draft.
Leaving the host marks an unresolved dispatched deletion unknown; an exact acknowledgment
can still confirm it while the same controller/actor remains active. Actor retirement clears the receipt.
An undispatched deletion can be cancelled without sending DELETE.

For retry, freeze `revocation.keyId` when opening confirmation, then use that same ID
for the deliberate command. Never substitute the selected table row or infer identity
from a matching name. Optional `revoke(id, {name, organizationName})` metadata is display-only.
Without safe metadata, the ready confirmation explicitly displays the saved key ID.
A request refusal is distinct from a failed session check; neither confirms revocation.
