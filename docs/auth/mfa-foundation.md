# Account MFA architecture

AMCore provides account-owned multi-factor authentication (MFA). Operators and
already protected accounts use a local password plus an authenticator code or
unused backup code. Ordinary accounts keep their existing sign-in policy.
Browser credentials stay in the BFF vault; native API clients receive their own
credentials after completing the same account policy.

MFA is not enabled automatically. Follow the separately approved
[deployment procedure](mfa-deployment.md) before activating the durable protocol.
[Browser journeys](mfa-browser.md) cover setup, settings and recovery.

## Deployment boundary

API and worker startup accept an absent marker or version 1 in `prepared` state
only without protected account/factor data. They accept compatible `active` state
only with a configured current encryption key. Unsupported states or versions
refuse startup. Prepared state never grants operator privileges.

The deployment CLI checks image evidence, schema, retained keys and actual
schema-owner authority. Activation and its audit commit atomically; no HTTP or
Console setting can switch the protocol off. Preflight does not attest remote
fleet completeness or close ingress. Binaries predating this check cannot enforce
it; the operator owns the image allowlist and closed-ingress upgrade boundary.

## Storage boundaries

| Record                     | Responsibility                                                             |
| -------------------------- | -------------------------------------------------------------------------- |
| `MfaAccount`               | Account security version, setup acknowledgement and backup-code generation |
| `MfaFactor`                | Encrypted TOTP seed and globally accepted time step                        |
| `MfaRecoveryTicket`        | Hashed, single-use deployment recovery authority bound to account/version  |
| `MfaRecoveryCode`          | Owner/generation-bound hash and atomic consumption timestamp               |
| `AuthSessionFamily`        | Durable family authority, proof identities and revocation                  |
| `BrowserAuthContext`       | Browser publication generation and exact vault binding                     |
| `MfaFlow` / `MfaOperation` | Purpose-bound continuation and nonsecret operation state                   |
| `MfaAttemptBudget`         | Account attempt history and bounded verification admission                 |
| `MfaProtocol`              | Durable deployment compatibility marker                                    |

These records live in the core schema. They remain independent of the optional
Console frontend. Adding a record does not publish a session or grant a role.
Existing sessions receive no positive assurance from the migration.

## Factor verification

The TOTP adapter uses a 20-byte random seed, SHA1, six digits and 30-second steps.
It accepts the current step and one adjacent step in either direction.
A successful verification advances the account's accepted step; reuse and a
backward clock cannot lower that value. TOTP does not resist phishing relays.

Backup sets contain ten independent 128-bit random codes. Only domain-separated
SHA256 hashes bound to account and generation enter the database. Consumption
and set replacement use the account session-coordination advisory lock.
A code is unavailable until setup acknowledgement. The last code remains valid.

`MfaProofRepository` uses its caller's transaction. The caller must validate the
exact continuation, source family, browser binding, account version and current
proof requirements before consumption. It must enforce account/source/flow
limits and commit the security effect, audit and notification intent together.
The password, OAuth, invitation and account-security adapters use these
coordinators for proof consumption, factor binding, code regeneration and family
publication. None can bypass the deployment activation boundary.
Rolling back the transaction also rolls back consumption. After a committed
transaction, a lost response never makes the code unused again.

The pure continuation predicate checks purpose, audience, binding, state,
deadline, account version and exact live source family. It grants no ordinary
rights and does not replace credential validation, locking or freshness checks.
The pure predicate refuses transfer authority. A separate locked validator accepts
only an exact committed setup transfer: predecessor, new account version, bound
factor and browser revision must match. An arbitrary revoked family cannot
authorize a setup successor.

## Password and publication transport

Independent ordinary clients retain a successful password response with their
access token and refresh cookie. A protected account requires active protocol
version 1; prepared deployments return 503 without issuing a password-only session.
An active protected password attempt returns 202 with a purpose-bound continuation
and no ordinary credentials. Dedicated continuation commands reject bearer,
cookie and API-key authority. They never construct an ordinary request actor.
`POST /auth/mfa/password` verifies the local password for that exact continuation.
Its response contains only proof status. An absent local password returns
`password_setup_required`; the browser offers the existing password-recovery route.
A valid password can still leave `second_factor` required. Neither result issues
credentials or permits a sensitive operation. Repeating the same operation does
not renew proof time. A changed purpose, account version or source family refuses
continuation.

Private browser password admission first returns a restricted continuation,
including for an ordinary account. The BFF must retain it before requesting
credentials with its own completion operation. An ordinary browser receives no
human MFA challenge. Its pending family still requires exact browser publication.
Losing the first response leaves an expiring reservation without session credentials.

Factor verification consumes one TOTP step or backup code. Completion returns
credentials only once. A repeat returns nonsecret publication status. The recipient
must retain pending credentials and acknowledge their exact publication before use.
The acknowledgement checks a signed pending proof, continuation, operation and,
when applicable, browser generation, staged vault binding and receipt. Status and
retirement never return credentials or publish another family. These routes do
not confirm invitation handoffs; their combined coordinator remains separate.

## Restricted setup and code delivery

The guarded `/auth/mfa/enrollment`, `/auth/mfa/bind-factor`,
`/auth/mfa/acknowledge-codes`, `/auth/mfa/recover-setup-codes` and
`/auth/mfa/redeem-recovery-ticket` handlers expose
these existing coordinators. They require an exact restricted continuation and
its actual browser binding when browser-bound. Mixed bearer, cookie, API-key or
invitation credentials are refused. They create no ordinary request actor.
See [the browser journey](mfa-browser.md#initial-setup-and-lost-responses) for
publication and lost-response behavior; OpenAPI defines the wire shapes.

Binding consumes the new app's TOTP step, advances the account security version,
revokes old families and creates a setup-only successor in one transaction.
Audit and notification intent join that transaction. The successor retains the
original password-proof time and deadline. Saving codes acknowledges the exact
current generation; it does not issue ordinary credentials.

Plaintext backup codes appear only in the winning response. An operation retry
returns nonsecret state. Lost first-setup codes require a fresh password proof
and the bound app's next unused TOTP before creating a replacement set.
The bound factor remains after a lost response or an expired setup flow.

For a configured account, regeneration requires a live source family and fresh
password plus TOTP or backup-code proof. A last-code login can supply that proof.
Regeneration invalidates unused old codes and incomplete old-generation proofs.
It preserves already committed family proofs, unrelated sessions and the account's
completed setup. Its save acknowledgement belongs only to that flow.

Restricted initial-enrollment and signed-in source-family handlers expose these
contracts. The deployment activation boundary still applies.

## Session admission

A parameterized primary SQL projection reads account, family, browser context and
current database time together. The JWT strategy can retain that projection only
for its enclosing request's selected principal. Admission consumes it once; role
selection reuses the same decision. Standalone JWT consumers keep their existence
check. Refresh, publication and locked sensitive checks read fresh authority.
The BFF probe uses the same projection with its exact refresh-lineage proof.
Its preflight and the subsequent API admission remain separate checks. This
reduces repeated reads; it does not remove ordinary-browser checks or establish
an acceptable performance budget.

JWT admission checks current primary account, family and actual private browser
binding before constructing privileges. Refresh keeps the same family and account
version. It rotates the token row and preserves both proof identities and
verification times. Issuance also records a conservative retention boundary; it
does not extend authentication proofs. A changed family or browser returns terminal `409 SESSION_CHANGED`;
it cannot select another credential or become an automatic refresh retry.
Sensitive and command admission uses the signed family, even after refresh rotates
or removes a historical token row. That row cannot become an alternative authority.

Protected sensitive actions require independently fresh password and TOTP or
backup-code proofs. Each proof lasts at most ten minutes. A shorter route window
also applies. `403 STEP_UP_REQUIRED` includes `details.requiredProofs` naming only
the missing or stale proofs. A legacy `lastAuthAt` update cannot satisfy MFA.
Ordinary accounts retain password freshness. Prepared state refuses protected grants.
The legacy password endpoint verifies only primary evidence. Its protected partial
result is credential-free `202`, naming the remaining proofs. It preserves current
MFA evidence and cannot claim completion from a password timestamp alone.
Mutating callers must repeat admission inside their ordered, locked transaction.
Internal role and session commands repeat that check after strict audit, before
commit. Background-work control uses the same family policy at admission and
dispatch. It preserves its stricter transaction timeouts and samples proof time
after security-lock waits. These checks do not cancel already admitted work.

Family access issuance records the signed token lifetime in the same transaction
as its security effect. Retention covers the later refresh deadline, signed access
expiry and database issuance time plus that lifetime. A shorter later lifetime
cannot shrink this boundary. Unknown older retention remains ineligible for cleanup.
Organization exchanges retain the exact family, security version and browser marker;
their parent-bounded expiry adds no later retention deadline.

Family revocation retires that family's authority and its derived continuations.
It does not advance the account version or cancel independently authorized login.
Browser logout additionally advances the exact browser generation and retires its
pending flows. A stale generation or mismatched old refresh cookie cannot log out
a later account. An independent API family's logout does not change browser state.
A worker-only `mfa-retention` job runs every five minutes. Each pass attempts at
most fourteen batches of100 rows across its seven cleanup buckets. It scrubs expired flow data, retains nonsecret receipts
for at least24 hours and deletes a flow only after its receipts are gone. It never
deletes a bound factor or resets replay state. Family and browser records retain
their issuance deadlines and references. Read-time expiry applies before cleanup.
Scheduled evidence reports removed/examined counts, remaining backlog and failures;
a truncated or partly failed pass reports a partial result.

## Encryption configuration

`MFA_ACTIVE_KEY_ID` selects the write key from `MFA_ENCRYPTION_KEYS`, a secret JSON
mapping of key IDs to canonical base64-encoded 32-byte keys. Both variables may
be absent while the protocol is prepared. Setting them does not activate MFA.
Missing or invalid keys make cryptographic operations unavailable.

The codec uses AES256GCM with a fresh 96-bit nonce, 128-bit tag and associated
data containing the format version, account ID and factor ID. Stored factors
retain their key ID so the codec can read a retained key after write-key rotation.
The keyring is separate from JWT secrets. Never log or put it in source control.

For administrative recovery and key rotation, use the
[deployment procedures](mfa-deployment.md#recover-an-account-without-its-app-or-codes).

### Source-session continuation

`POST /auth/mfa/session-flow` requires the original authenticated bearer token and,
for browser families, the trusted current browser binding. A caller cannot select
a family in the body. It returns a restricted continuation for reauthentication,
code rotation or app replacement; it does not replace or publish a session.
`POST /auth/mfa/reauthenticate` consumes that continuation's committed fresh proofs
into only its original family. Repeated completion never renews timestamps.
Revocation of the original family invalidates every derived continuation.
Website and product-admin account-security adapters connect source-bound code
rotation and app replacement.

<!-- AMCORE_CONSOLE_MFA_ADAPTER_START -->

The Console step-up adapter connects reauthentication. Host Console selects its
own HTTPS audience, cookie and Redis namespace; it uses the same publication and
continuation protocol.
<!-- AMCORE_CONSOLE_MFA_ADAPTER_END -->

`GET /auth/mfa/settings` returns only the admitted account label, eligibility,
protection state and count of unused codes. `POST /auth/mfa/rotate-codes` requires
an own `rotate_codes` continuation with fresh proofs. It keeps the original family
and returns the new plaintext set once. Repeating the same operation returns its
generation without the codes. Acknowledgement names the exact saved generation.

The browser retains the private continuation in Redis, bound to its selected
vault, family, browser generation and anchor. A later sign-in cannot take over the
operation. App replacement reuses enrollment and binding. Only a validated
replacement result can retain the restricted setup successor after revoking the
source family. The user must save its codes before the new session is published.
Losing that binding response before successor retention requires a new sign-in;
it cannot restore the retired source session.

## Browser adapter contract

Dedicated BFF entries are `/api/auth/mfa` and `/api/product-admin/auth/mfa`.
They select the canonical frontend context before any work. Pending GET reads the
selected continuation's nonsecret status. POST confirms a local password, verifies
an app or backup code,
completes password login, or cancels that exact browser attempt. An untrusted
mutation returns 403; the wrong frontend host returns 404. Initial setup uses restricted enrollment handlers. Signed-in settings capture
the exact current family before rotation or replacement. Emergency recovery
accepts only a previously issued server-administrator ticket with the local password.
Responses use `Cache-Control: private, no-store`. The generic authenticated proxy
denies all `/auth/mfa` upstream paths.

Before password submission, `/api/auth/browser-context` creates a neutral browser
anchor and a separate pending attempt. Product administration uses its own BFF
entry and selected audience. The anchor is an HttpOnly session cookie. Browser
JSON receives only a nonsecret attempt identifier. A protected account receives
no ordinary session until its required proofs and publication complete.
A source-budget refusal returns `429 RATE_LIMIT_EXCEEDED` with a valid
`Retry-After` delay when supplied. Bootstrap issues no attempt or credentials
on refusal; wait before starting another sign-in or registration.

A known expired anchor keeps its existing binding. Under the context and sorted
account locks, bootstrap retires the expired generation and its authority, advances
the generation and renews only neutral state for 15 minutes. It issues no session
or credentials and restores no old MFA, invitation or return proof. Fresh credentials
and publication remain separate. The BFF still refuses replacement anchors while
session or pending capabilities remain visible. A missing record is not proof of ownership.

The BFF retains the continuation before requesting credentials. One Redis update
stores the pending vault and its operation journal. The API then confirms the
exact publication. Readers verify the selected family, account security version,
browser generation and audience against the API before returning identity or
credentials. They repeat verification across token refresh. A changed context
fails with `AUTH_CONTEXT_CHANGED`; it never triggers automatic refresh.

Logout requires the session identifier captured by the displayed screen. The
API retires that exact browser generation before the BFF removes its selected vault record.
Responses do not clear fixed-name browser cookies: a delayed response must not
erase a newer login. Retired pointers confer no authority.
An older screen cannot log out a newer winning session. An unavailable API leaves
the outcome unconfirmed; the BFF does not report successful logout or clear the
stable browser anchor.

Password and OAuth invitations use the restricted combined confirmation. It validates
the exact pending attempt before one database transaction confirms the handoff and
publishes its family. Membership still requires separate acceptance. The BFF also
checks the actual invitation owner before recovering a lost confirmation response.
Ordinary and invitation-bound browser registration retain a private publication
proposal before account creation. Account, pending family/session and email token
commit together. The BFF confirms publication before setting its session cookie.
Independent clients retain separate API sessions. Protected provider linking
captures its original family and local proof freshness through the callback.
A provider identity cannot bypass required local proofs or publish a browser session.

## Component and adapter boundaries

`features/account-mfa` exports a headless controller and the reusable journey.
The app layer chooses the frontend adapter and destinations. Shared strict Zod
schemas define browser states and commands. Raw backend continuation, JWT,
refresh-token and publication-receipt fields are excluded from browser results.
Unknown fields are rejected, rather than silently copied into client state.

The controller keeps a setup key and a newly issued backup set outside its
serializable snapshot and the Query cache. Concealment invalidates in-flight
responses. Page exit, unmount and a safe status read erase displayed secrets.
A restored page reads nonsecret status; it cannot redisplay an issued set.
A changed-session response removes the previous identity and secrets.
Backend services separately enforce family and publication authority.

Read-only status checks reveal nonsecret state. Recovery can also send an
origin-checked, bounded command. `reconcile_login` may perform the canonical first
completion dispatch or acknowledge the exact staged publication. Settings-start
resolution may atomically abandon an unprogressed start or create a tombstone
that rejects its delayed delivery. Exact logout-result lookup is read-only;
claiming that logout's return binds it to one neutral attempt. These operations
never replay a password, code or another attempt's credentials. Use the
[typed browser commands](../../packages/shared/src/schemas/mfa-browser.ts) and
[logout receipts](../../packages/shared/src/schemas/browser-logout-receipt.ts)
with the [API reference](reference.md).

A known rate refusal preserves `429`, its error code and `Retry-After`; it does
not enter unknown-result recovery or automatically start another flow. A changed
source requires a new sign-in. The server still owns proof freshness, one-time
consumption, rate limits, family binding and transaction outcomes.

<!-- AMCORE_CONSOLE_MFA_RECOVERY_START -->

If a Console logout cannot be confirmed, offer an explicit new sign-in without
the old return reference; successful admission then opens the overview. Never
infer logout success from a missing receipt.
<!-- AMCORE_CONSOLE_MFA_RECOVERY_END -->

## Extend MFA to other users

The mechanism belongs to the account, not to Console or an organization role.
The current shipped policy requires MFA for `SUPER_ADMIN` and preserves protection
for accounts with `required`, `emergencyRequired` or a bound factor. It does not
offer initial enrollment to never-protected ordinary users. There is no supported
configuration flag or public administrative endpoint for widening that rollout.

A downstream extension requires reviewed code changes and its own rollout approval.
First establish the current deployment state. In `prepared`, first activation
requires the existing closed-ingress [activation procedure](mfa-deployment.md).
In compatible `active` state, widening policy does not activate the protocol again.
Deploy the reviewed policy change using the normal approved deployment procedure;
verify new and unaffected users before exposing the changed admission policy.
Owner approval of this policy rollout is separate from the original activation.
Neither case permits a protocol downgrade or a password-only protected fallback.

Complete these steps before enabling the wider policy:

1. Define who may enroll and who must use MFA. Change `enrollmentEligible` and
   `accountRequiresMfa` in `apps/api/src/core/auth/mfa/mfa-account-policy.ts`
   separately. Enrollment eligibility alone must not require MFA before binding.
   Keep bound factors and emergency-required accounts protected after role changes.
2. Reuse account-owned factors, recovery codes, continuations and session families.
   Do not create role-specific factor tables or another password-only login route.
   Reuse the existing website/product-administration account-security adapters and
   `features/account-mfa` journey. Derive eligibility from the server settings response.
3. Define policy transitions for existing sessions and incomplete enrollment.
   Use the existing ordered account locks and transactional security-version/family
   invalidation when a transition must retire authority. A profile flag or client
   setting alone cannot change server admission. Organization membership and roles
   remain separate authorization decisions; MFA grants neither.
4. Extend `mfa-account-policy.spec.ts` and the affected HTTP/BFF/browser tests.
   Cover newly eligible users, required users, unaffected ordinary users, role
   removal, existing sessions, OAuth, invitations, last-code login and recovery.
   Preserve fresh proof requirements for sensitive actions and original-family
   revocation for every continuation.

```text
Enrollment policy -> existing setup journey -> account-owned factor
Login policy -> password + required proof -> exact session publication
Role/organization policy -> independent authorization
```

Keep the browser anchor, publication generation and all reader/refresh checks.
A late cookie must never restore old identity. Invitation confirmation must still
validate the exact attempt and commit handoff with publication atomically.
Do not admit protected accounts in `prepared` state or weaken fleet/key checks.
Measure ordinary request cost and route JavaScript when expanding shared paths;
keep MFA client code scoped to its owning interactive journeys. Use the existing
[route bundle budgets](../frontend/bundle-budget.md) and the affected
[frontend verification lanes](../frontend/testing.md); do not raise limits to hide
a regression. Agree any new request-cost acceptance criterion with the owner.
