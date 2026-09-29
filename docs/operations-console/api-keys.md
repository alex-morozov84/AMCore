# API keys

Use API keys to inspect credentials across users and organizations and revoke
compromised or obsolete integrations. Console access requires a current platform
`SUPER_ADMIN`; the operator need not belong to the target organization. API keys
cannot authenticate Console operations. No credential secret, short token, hash
or salt is returned by this inventory.

## Find a key

Search performs a literal, case-insensitive substring match against key names,
with at most100 characters. Status, exact key ID, owner and organization filters
combine with search. Owner/organization IDs accept CUID or UUID; key IDs are CUID.
Current-name lookup applies an exact ID. Clear filters restores the full inventory.

The default is20 rows per page, newest first. A direct URL may select a limit from
1 to100. Sort name, creation, expiry, last use or revocation; nullable dates sort
last and key ID breaks ties. Search/filter/sort changes reset to page1 while
preserving other filters. URLs and GET forms support bookmarks and browser history.

Desktop rows and mobile cards show safe metadata, owner/organization context
links, scopes and timestamps. ID copy identifies the credential, never its secret.
The statuses describe credential lifecycle:

| Status    | Meaning                                                    |
| --------- | ---------------------------------------------------------- |
| Unexpired | No expiry, or expiry is strictly later than the query time |
| Expired   | Expiry reached; not explicitly revoked                     |
| Revoked   | Irreversibly revoked, even if also expired                 |

Unexpired does not promise effective access. Current owner rights, membership and
scopes still apply. Last use is approximate and may lag an hour; it cannot prove
that every consumer has migrated. Audit links open a bounded interval for the
key's durable ID; an empty result does not prove absence of older history.

## Revoke

Choose **Revoke** from a row, or select eligible keys on the current page and
choose **Revoke selected**. Select-page means this page only, never all matching
results. Bulk accepts at most100 distinct IDs. Expired keys can be explicitly
revoked; historical revoked keys offer Audit only.

Confirmation captures the names, owners, organizations and IDs. Targets stay
fixed through password step-up. Revocation destroys the verifier and cannot be
undone. Consumers lose access on verification after commit; an already admitted
request may finish. Success reports actual affected/requested counts. A known
already-revoked key is a no-op and keeps its first revoker, time and reason.

An unknown or purged target returns404 and rolls back the entire bulk request.
The screen refreshes and asks you to select again. Other errors preserve selection
for an explicit retry.429 includes Retry-After; no automatic revoke retry occurs.
Single revoke uses20 requests/minute with burst20; bulk uses5/minute with burst5.
Read uses30/minute with burst20. These are the existing API rate policies.

Inventory responses and fixed mutation transports are private, no-store. Successful
reads require a durable audit entry; audit failure prevents a metadata response.
Actual transitions record `api_key.revoked`; every successful platform request,
including a no-op, records `admin.api_keys.revocation_requested` counts. Read
`admin.api_keys.viewed` is hidden by default in Audit's optional read-event filter.

## Retention and boundaries

Safe metadata becomes purge-eligible30 days after the first terminal time: expiry
or revocation, whichever occurred first. The next successful cleanup deletes it;
parent user/organization deletion can remove it sooner through Cascade. Audit has
independent retention. There is no reconstructed history for previously deleted
keys and no permanent archive guarantee.

Keys remain user-owned and organization-bound. Membership removal retains them
but denies authentication; rejoining can restore access to an unexpired, unrevoked
key within current rights/scopes. Explicit revoke is permanent. Organization removal
warnings/manual key management belong to the product administration workflow.

This screen does not issue keys, edit scopes, rotate via a dedicated endpoint,
transfer ownership or revoke every key of an owner/organization. For planned
replacement, create a new own key, migrate and verify consumers, then revoke the
old key. For compromise, revoke first. See [API key lifecycle](../auth/api-keys.md)
and the [deployment/restore runbook](../operations/api-key-lifecycle.md).
