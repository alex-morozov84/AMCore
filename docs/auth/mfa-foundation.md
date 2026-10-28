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
| `AuthSessionFamily`        | Reserved storage for durable authentication authority                      |
| `BrowserAuthContext`       | Reserved storage for browser publication generations                       |
| `MfaFlow` / `MfaOperation` | Purpose-bound continuation and nonsecret operation state                   |
| `MfaAttemptBudget`         | Reserved account attempt-history storage                                   |
| `MfaProtocol`              | Durable deployment compatibility marker                                    |

These records live in the core schema. They remain independent of the optional
Console frontend. Adding a record does not publish a session or grant a role.
Existing sessions receive no positive assurance from the migration.

## Internal verification

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
Internal coordinators apply these checks to password proofs, factor binding,
code regeneration and pending family publication. Password HTTP admission uses
these coordinators. OAuth/invitation integration and the complete deployment
protocol remain unfinished; these helpers do not enable MFA.
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
contracts. The deployment boundary above still applies.

## Internal session admission

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
most ten batches of100 rows. It scrubs expired flow data, retains nonsecret receipts
for at least24 hours and deletes a flow only after its receipts are gone. It never
deletes a bound factor or resets replay state. Family and browser records retain
their issuance deadlines and references. Read-time expiry applies before cleanup.
Scheduled evidence reports removed/examined counts, remaining backlog and failures;
a truncated or partly failed pass reports a partial result.

These internal checks do not complete the public login, BFF or deployment protocol.

## Encryption configuration

`MFA_ACTIVE_KEY_ID` selects the write key from `MFA_ENCRYPTION_KEYS`, a secret JSON
mapping of key IDs to canonical base64-encoded 32-byte keys. Both variables may
be absent in the dormant deployment. Setting them does not activate MFA.
Missing or invalid keys make cryptographic operations unavailable.

The codec uses AES256GCM with a fresh 96-bit nonce, 128-bit tag and associated
data containing the format version, account ID and factor ID. Stored factors
retain their key ID so the codec can read a retained key after write-key rotation.
The keyring is separate from JWT secrets. Never log or put it in source control.

### Bounded key maintenance command

`pnpm --filter api auth:mfa -- rotate-key` re-encrypts at most100 existing factors
with the configured active key. It reads `DATABASE_URL`, `MFA_ACTIVE_KEY_ID` and
`MFA_ENCRYPTION_KEYS`; it does not initialize HTTP, JWT or Redis services.
`--after-user-id <account-id>` continues after a returned `nextUserId`.
Each account commits separately. The command changes neither factor identity nor
replay counters, account security version, backup codes or session proofs.

Output contains counts, a cursor and whether old references remain. `complete`
means no old factor references were observed; `more` needs another batch. `partial`
returns exit3 and retains failed factors. An unavailable database or uncertain
result returns `unconfirmed`, exit4; earlier account transactions may have committed.
Inspect references and repeat safely. Missing input/key configuration returns exit2.
The command never prints plaintext seeds, keys or connection strings.

This command does not activate MFA or implement total-loss recovery. Old keys must
remain available to replicas and matching database backups that still need them.
A successful batch alone does not prove fleet migration or backup restoration.
Unbound drafts can still reference the old key until their bounded expiry and
cleanup. Deployment preflight checks factor and draft references. Retain old keys
until those records disappear and retain matching keys with older backups.

### Internal offline recovery boundary

`pnpm --filter api auth:mfa -- recover --user-id <account-id>` requires a private
POSIX terminal and an actual core-schema owner, owner-role member or superuser.
Runtime table DML and the application SUPER_ADMIN role are insufficient.
The target must already be MFA-protected and have a local password. Complete
normal verified password recovery before issuing a ticket if that password is absent.
The command requires the active supported protocol. The recipient finishes
recovery through the restricted browser/API setup journey. Recovery is not activation.

The terminal asks for a reason and exact target confirmation. The reset transaction
revokes sessions and continuations, advances the account security version, removes
the old factor/codes and preserves required MFA with emergency enrollment pending.
It records strict audit and notification intent together. A missing old encryption
key does not prevent targeted reset; enrollment still needs a healthy active key.

The command displays one15-minute enrollment ticket only on the verified private
terminal. JSON outcomes, logs, audit and notifications never contain that ticket.
The database stores only its domain-separated hash. Password reset or another
offline reset invalidates earlier tickets. A lost ticket needs another confirmed reset.
The terminal check verifies device identity, OS owner and read permissions; the
operator must also keep the terminal private and unrecorded.

Password plus ticket grants only a new setup continuation. It creates no ordinary
session. Ticket consumption is single-use and rotates the continuation; a lost
winning response cannot recover its secret through the old parent. The user must
then connect a new app, verify its TOTP and acknowledge the new backup codes.
The emergency flag clears only at binding; completed setup remains pending until
code saving. These internal flows do not complete the HTTP/BFF deployment protocol.

A refused prerequisite changes nothing. A failed strict transaction rolls back its
security changes and intent. `unconfirmed` never promises rollback after an uncertain
commit. If the ticket cannot be displayed after commit, a new confirmed reset is
required. There is no support UI, HTTP reset endpoint, master code or global MFA-off
operation for this recovery path.

### Source-session continuation

`POST /auth/mfa/session-flow` requires the original authenticated bearer token and,
for browser families, the trusted current browser binding. A caller cannot select
a family in the body. It returns a restricted continuation for reauthentication,
code rotation or app replacement; it does not replace or publish a session.
`POST /auth/mfa/reauthenticate` consumes that continuation's committed fresh proofs
into only its original family. Repeated completion never renews timestamps.
Revocation of the original family invalidates every derived continuation. The
Console step-up adapter connects reauthentication. Website and product-admin
account-security adapters connect source-bound code rotation and app replacement.
Host Console selects its own HTTPS audience, cookie and Redis namespace; it uses
the same publication and continuation protocol.

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
