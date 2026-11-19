# Secret Rotation

Use this guide to replace credentials in an existing deployment. Read the
[production deploy profile](production-deploy-profile.md) and inventory every
process and external consumer before changing a secret. Preserve the installation's
project, environment files and complete Compose file selection throughout.

This guide covers JWT signing, database and Redis credentials, OAuth/provider
keys, webhooks and metrics. It does not inventory every secret in a downstream
product. For MFA encryption keys, follow
[MFA key maintenance](../auth/mfa-deployment.md#rotate-encryption-keys): distribute
retained read keys, migrate stored factors and retain keys required by backups.
Do not apply the JWT cutover procedure to that keyring. MFA activation requires
separate approval; key maintenance does not grant it.

Browser cookies identify server-side sessions; they are not JWT signing keys.
TLS certificate rotation belongs to the reverse proxy or certificate manager.
Keep secret values out of command arguments, logs, reports and shell history.
The procedures below describe planned rotation. A compromise may require immediate
revocation and a controlled outage rather than retaining a compromised credential.

## JWT_SECRET

AMCore signs and verifies access JWTs with one `JWT_SECRET`. It has no JWT `kid`
selection or overlapping verification keys. Rotating this value invalidates
old-signature access tokens at each updated API process.

### What actually breaks, verified against the real request path

Access JWTs expire after `JWT_ACCESS_EXPIRATION` (default `15m`). Refresh tokens
are random opaque values stored by hash in PostgreSQL; they do not use `JWT_SECRET`.
Rotation alone does not revoke them or their session families.

The BFF checks the vault's recorded access-token expiry with a 30-second safety
margin. It does not detect a signing-key change. Its authenticated proxy forwards
an API response once; it does not force refresh and replay an API 401. The default
Query policy does not retry 401 either. Users can therefore see 401 responses
until a later request triggers normal proactive refresh.

Recovery through refresh requires a still-valid refresh credential, session/family,
browser binding and reachable dependencies. Expiry, revocation or a separate
security event can require sign-in. There is no unconditional recovery guarantee.

A mixed fleet rejects different token generations depending on which API answers.
The usual access-token expiry bound applies only after the entire serving fleet
uses the new secret. Avoid a rolling mixed-key fleet.

### Rotation procedure

1. Generate a strong new secret in the deployment's approved secret mechanism.
   `JWT_SECRET` requires at least 32 characters. Distribute the replacement
   without exposing its value in arguments or logs.
2. Plan the access-token error window with the actual clients. With the default
   TTL, retained old tokens can fail until normal refresh. The shipped BFF records
   a fixed 15-minute access-token lifetime. Changing only `JWT_ACCESS_EXPIRATION`
   does not update that estimate. Do not shorten the backend TTL as a browser-error
   mitigation without verifying matching client behavior.
3. Switch the entire serving API fleet together. Use a verified blue-green
   traffic switch, or close ingress, drain requests and recreate every serving
   API/worker replica before reopening. A plain Compose recreate is not an
   atomic traffic switch; keep ingress closed during the transition. Follow
   [deployment rollout](deployment.md#zerolow-downtime-rollout--stated-honestly).
4. Verify fresh login and API authorization. Verify that a captured old-signature
   access JWT is rejected. With a controlled retained session, verify eventual
   refresh under the new key. Restore the normal TTL afterward if appropriate.

JWT rotation is not a global logout procedure. Do not delete `core.sessions`
alone as a substitute for supported session/family revocation. Follow
[session invalidation](../auth/sessions.md#when-sessions-are-automatically-invalidated) and account recovery
for the intended scope. A deployment-wide compromise needs a separately reviewed
containment and revocation procedure; this guide supplies no bulk SQL shortcut.

## Database credentials (`amcore_migrator` / `amcore_runtime`)

Follow [database role separation](database-role-separation.md). PostgreSQL keeps
one password per role. Changing it preserves already-authenticated connections,
but every new or re-established connection must use the new password. An old
replica's pool can open new connections before that replica restarts, so a rolling
restart reduces disruption without guaranteeing zero errors.

1. Generate separate strong, unique passwords for the runtime and migrator roles.
2. Change each password through interactive `psql` `\password`, entering it from
   the approved password manager. Never send a cleartext password in literal
   `ALTER ROLE ... PASSWORD` SQL. Utility tracking can expose that statement
   through query statistics. `\password` avoids sending cleartext but does not
   make credential-derived artifacts nonsensitive. Follow
   [statistics security](pg-stat-statements-security.md) and
   [exposure recovery](pg-stat-statements-recovery.md).
3. Update runtime `DATABASE_URL`/`COMPOSE_DATABASE_URL` and the separate
   `MIGRATION_DATABASE_URL` in the actual deployment's secret mechanism.
   Preserve correct URL encoding and TLS settings. Pause migration one-offs
   while changing the migrator credential.
4. Promptly roll API/worker processes and any other runtime consumers with the
   new configuration. Verify new connections and application operations. Monitor
   reconnect failures; use a maintenance window if that temporary risk is unacceptable.
5. Verify the migrator can establish an authorized connection before the next
   deployment. Do not run a schema migration merely to test a password.

Rotate `amcore_backup` and `BACKUP_DATABASE_URL` separately when the optional
backup reader is used. Recreate the backup service with the updated configuration
and verify a completed dump. A container restart alone does not reload changed
Compose environment values. Keep the previous verified backup until its successor
has passed the required checks.

### `amcore_observer` (`pg_stat_statements` investigation role)

The shipped application does not connect as this operator role. Change its
password with interactive `\password amcore_observer`, then update the operator's
protected credential store. Verify a new connection. Existing operator sessions
are not disconnected by a password change; terminate unauthorized sessions through
an approved incident procedure if compromise requires that. Inventory any custom
consumer before assuming no process needs an update. See
[observer privileges](pg-stat-statements-observer-role.md).

## Redis (`REDIS_URL`)

Use the [production Redis configuration](deployment.md#redis-production-profile).
A named Redis ACL user supports multiple active passwords. Check the provider's
persistence mechanism so rotation survives a server restart.

1. In a protected Redis administration session, use `ACL SETUSER` to add the
   replacement password with the `>` rule. Preserve the existing password and
   permissions. These are Redis protocol rules, not shell redirections; do not
   paste secret-bearing commands into shell history or recordings. See
   [Redis ACL SETUSER](https://redis.io/docs/latest/commands/acl-setuser/).
2. Update `REDIS_URL`/`COMPOSE_REDIS_URL` for every consumer, including API,
   workers and web BFF vault connections. Recreate/redeploy them with the new
   configuration and verify newly authenticated connections and operations.
3. After every consumer has moved, remove only the old password with the `<`
   rule. Persist the ACL change using the provider's supported mechanism and
   verify new connections again. Removing a password is not proof that already
   authenticated clients were disconnected.

A single `requirepass` credential has no overlap period. Existing authenticated
connections can continue, but an old-config reconnect fails after the change.
Coordinate the server change and all consumer updates promptly, or use a closed
maintenance window. Correct the secret/configuration before retrying authentication;
do not remove authentication to recover service.

Queue processing can stall and retries can repeat external effects. AOF persistence
alone does not prove that every acknowledged job or outside effect is preserved.
Follow the deployment's queue recovery policy before resuming uncertain work.

## OAuth provider secrets (`GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_SECRET`)

Google supports overlapping client secrets for eligible clients. Check the current
client configuration and limit in [Google's client management guidance](https://support.google.com/cloud/answer/15549257).

1. Create the replacement secret without disabling the credential still serving
   traffic. If the limit prevents overlap, plan a controlled cutover first.
2. Update `GOOGLE_CLIENT_SECRET` and redeploy all consumers.
3. Verify a real end-to-end Google sign-in under the replacement configuration.
4. Disable/delete the old secret after successful verification.

Do not assume another provider offers the same overlap. Check its supported
rotation procedure before changing GitHub or other configured OAuth credentials.
If replacement immediately invalidates the old value, coordinate both sides and
expect provider-specific sign-in interruption until the new configuration works.

Apple uses `APPLE_PRIVATE_KEY` and `APPLE_KEY_ID` to sign its client-secret JWT.
The current provider instance caches that JWT and discovery configuration; it
does not sign a new JWT on every exchange. Redeploy the API processes to use a
replacement key pair. Follow [Apple's private-key procedure](https://developer.apple.com/help/account/capabilities/create-a-sign-in-with-apple-private-key/):
securely retain the new downloadable key, update both fields together, verify
real Apple sign-in, then revoke the old key. Confirm account eligibility and
available key slots before relying on overlap.

## Third-party API keys (email, storage, AI providers)

This includes `RESEND_API_KEY`, the storage access/secret pair and configured
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `YANDEX_API_KEY`
and `AI_OPENAI_COMPATIBLE_API_KEY` slots. Rotation behavior belongs to the selected
provider/account; this guide does not guarantee independent overlapping keys everywhere.

1. Confirm the provider supports another credential with the needed permissions,
   quotas and endpoints. For AWS IAM users, see the
   [AWS rotation procedure](https://aws.amazon.com/blogs/security/how-to-rotate-access-keys-for-iam-users/).
2. Create the replacement where overlap is supported. Otherwise arrange a
   maintenance window before invalidating the current credential.
3. Update the complete credential pair/slot and redeploy all consumers.
4. Verify an authorized, bounded real operation against the intended resource.
   Startup alone does not validate a key. A storage health probe verifies only
   its configured target and permissions, not every upload/download operation.
5. Revoke the old credential after successful migration and verify new requests.

Do not retain a compromised credential merely to follow the planned overlap order.
Live provider calls require the deployment owner's execution and cost authority.

## Two-sided secrets (webhooks, metrics scraping)

The sender and receiver must agree on the same configured secret. AMCore accepts
one value per webhook provider and one configured metrics bearer token; it has no
old/new verification overlap for these values.

- For Telegram webhook rotation, update `WEBHOOK_TELEGRAM_SECRET`, redeploy and
  re-run the [one-shot registration](deployment.md#telegram-webhook-registration-one-shot-optional).
  Telegram's old configured secret fails verification until registration changes.
- For Stripe/generic webhooks, coordinate the provider signing-secret change and
  AMCore's `WEBHOOK_<PROVIDER>_SECRET` update. Verify delivery and handle retries
  under the [webhook verification contract](webhooks.md).
- For `TELEGRAM_BOT_TOKEN`, coordinate revocation/replacement through the provider,
  redeploy all token consumers and re-run registration. Verify affected notification
  and Telegram sign-in flows when configured.
- For configured `METRICS_AUTH_TOKEN`, update AMCore and every scraper together.
  Verify authenticated scrapes. A mismatch returns 401; do not disable protection
  to hide the failure.

## See also

- [Database role separation](database-role-separation.md).
- [Production deploy profile](production-deploy-profile.md).
- [Deployment and rollout](deployment.md#zerolow-downtime-rollout--stated-honestly).
- [Webhook verification](webhooks.md).
- [MFA key maintenance](../auth/mfa-deployment.md#rotate-encryption-keys).

## AMCore API keys

AMCore-issued integration keys are distinct from provider/environment secrets.
For planned replacement create a new own key, migrate/test consumers, then revoke
the old one; for compromise revoke first. Approximate last use cannot prove
migration. See [API keys](../auth/api-keys.md) and
[lifecycle restore safety](api-key-lifecycle.md).

Supported member removal permanently revokes AMCore keys in that organization.
Returning staff issue new keys; other organizations remain unaffected. Above1000
unrevoked keys, removal refuses without changes. Use the
[bounded maintenance recovery](api-key-lifecycle.md#more-than-1000-keys-or-oversized-metadata)
rather than relying on the departing member to clean up their credentials.
