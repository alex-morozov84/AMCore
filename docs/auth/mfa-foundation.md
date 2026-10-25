# Dormant MFA foundation

The API contains storage and internal verification primitives for account-owned
multi-factor authentication (MFA). This foundation does not enable MFA enrollment,
change login, enforce second-factor admission or expose recovery endpoints.
The current supported credential contract remains in [Auth contracts](reference.md).

## Deployment boundary

`MfaFoundationModule` has no controllers or activation writer. Its startup check
accepts an absent protocol record or protocol version 1 in `prepared` state.
It refuses any other protocol state, unsupported version, stored factor or
account marked as requiring MFA. An incomplete deployment must not serve an
MFA-protected database with password-only authorization.

This check cannot protect a database from a binary that predates the check.
It also does not permit mixed deployments or manual database activation.
There is no supported activation command in this foundation.

## Storage boundaries

| Record                     | Responsibility                                                             |
| -------------------------- | -------------------------------------------------------------------------- |
| `MfaAccount`               | Account security version, setup acknowledgement and backup-code generation |
| `MfaFactor`                | Encrypted TOTP seed and globally accepted time step                        |
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
Those complete orchestration and HTTP contracts are not provided here.
Rolling back the transaction also rolls back consumption. After a committed
transaction, a lost response never makes the code unused again.

The pure continuation predicate checks purpose, audience, binding, state,
deadline, account version and exact live source family. It grants no ordinary
rights and does not replace credential validation, locking or freshness checks.
It refuses unsupported authority kinds, including unimplemented transfer paths.

## Encryption configuration

`MFA_ACTIVE_KEY_ID` selects the write key from `MFA_ENCRYPTION_KEYS`, a secret JSON
mapping of key IDs to canonical base64-encoded 32-byte keys. Both variables may
be absent in the dormant deployment. Setting them does not activate MFA.
Missing or invalid keys make cryptographic operations unavailable.

The codec uses AES256GCM with a fresh 96-bit nonce, 128-bit tag and associated
data containing the format version, account ID and factor ID. Stored factors
retain their key ID so the codec can read a retained key after write-key rotation.
The keyring is separate from JWT secrets. Never log or put it in source control.
