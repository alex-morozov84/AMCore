# Explicit organization context

Organization handlers can use a personal JWT and an explicit target. The API
authenticates the credential, resolves current platform privilege, verifies the
target's current membership/version, and then constructs one ability. Selecting
an organization does not mint or replace a JWT.

## API contract

All paths below are relative to `/api/v1`. Organizations, members, roles and
invites declare an organization-context boundary. Each handler declares its own
personal, discovery, exchange or organization policy.

| Operation                                                                              | Context and credentials                                                                               |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `POST /organizations`                                                                  | Personal, bearer-only; creates ADMIN membership                                                       |
| `GET /organizations`                                                                   | Actor-owned discovery, bearer-only                                                                    |
| `GET /organizations/:id`                                                               | Existing membership discovery; accepted keys remain bound and scope-limited                           |
| `GET /organizations/:id/context`                                                       | Selected organization, bearer-only; current membership required even for SUPER_ADMIN                  |
| `GET /organizations/:orgId/capabilities`                                               | Selected organization, bearer-only; full TeamAccess; implemented authoring metadata only              |
| `POST /organizations/:orgId/roles/:roleId/permissions/presets`                         | Selected organization, bearer-only; full TeamAccess and custom role                                   |
| `GET /organizations/:orgId/members`, `GET /organizations/:orgId/members/:userId/roles` | Selected organization, bearer-only; current membership and full TeamAccess, including for SUPER_ADMIN |
| `PATCH /organizations/:orgId/members/:userId/roles`                                    | Same admission; atomic complete-set replacement with membership identity and ACL revision checks      |
| `PATCH /organizations/:id`, `DELETE /organizations/:id`                                | Selected organization; existing credential/field/TeamAccess requirements retained                     |
| Legacy per-role/member-removal and role handlers                               | Path-selected organization; existing per-handler credential allowlist retained                        |
| `GET/POST /organizations/:orgId/invites`, reissue/revoke and own operation receipts | Personal bearer; actual membership and full TeamAccess; no platform bypass or API-key admission |
| `POST /auth/invites/accept`                                                            | Personal, bearer-only                                                                                 |
| `POST /organizations/:id/switch`                                                       | Existing bearer-only exchange; membership-checked A→B and parent-bounded expiry retained              |

`GET /organizations/:id/context` returns the safe organization summary,
`canManageTeamAccess`, finite `actorAffordances` and actual-organization
`recordAffordances`. The actor map distinguishes unconditional `allowed`,
`recordRequired` (a real row is needed, with no existence guarantee) and
`denied`. Record hints include read, update-field and delete decisions for the
server-loaded organization row. The old boolean stays consistent with
`teamAccess.manage`. These are display affordances; every later operation
performs its own authorization.
Missing organizations and nonmembers both receive `404` on this overview and
existing JWT detail discovery. Other selected handlers retain `403` for missing
membership. No team, role or invitation management UI is implied by this API.

The authoritative selector is the declared path parameter. An optional
`X-AMCore-Organization-ID` must match it. A handler can instead explicitly
declare a header selector. IDs use `[A-Za-z0-9_-]{1,128}`; empty, duplicate,
array/comma, malformed or conflicting selectors return `400`. An organization
header on an undeclared operation is rejected. Request bodies never provide API
context authority. Organization PATCH accepts only `name` and `slug` and rejects
unknown fields.

A personal JWT receives request-local projected organization context; its signed
claims remain unchanged. A previously organization-bound JWT must match the
target for organization operations. Its discovery/exchange behavior remains
unchanged, including exchange to another organization with current membership.
Only explicitly marked existing handlers retain their live platform-admin
membership bypass for legacy bound JWTs. The overview and new member
list/snapshot/replacement operations require membership even for SUPER_ADMIN.
API keys retain their bound organization, current owner admission,
scope intersection and exact credential allowlist. Invite creation still accepts
approved API keys; pending list, revoke and acceptance remain bearer-only.

## Authorization freshness and extension

JWT selected-context admission performs one primary membership operation that
also obtains the organization's ACL version. This can produce more than one SQL
statement through Prisma. Ability construction and TeamAccess reuse the admitted
snapshot rather than reading membership/version again. API keys reuse their
already verified membership/version. Permission cache fills retain coherent
REPEATABLE READ loading; DENY, record/field checks, row locks and post-state checks
remain enforced. ACL changes must bump version in the same transaction.

No cached version substitutes for failed primary admission. Requests admitted
before a concurrent change can finish; this does not revoke JWTs, cancel committed
SQL, or add an atomic authorization check at commit.

For another tenant namespace, apply `@OrganizationContextBoundary(family)` to
its controller and `@RequestContextPolicy(...)` to each actual handler. Declare
its upstream root in the family's `apiRoots`; path selectors must resolve in
every declared class/method alias. Missing, conflicting or unresolvable metadata
fails before ability/handler execution. Import the context resolver/decorators
through `core/auth/organization-context`; use `CurrentOrganizationContext` for
the API-issued admission evidence, never deserialize that evidence from a body.
The guard applies after credential admission, outside credential fallback.

Keep family registration in retained application code, imported directly from
shared contracts independently of reference frontend removal. Add the same family
through the application's `_app/product-api` public
composition API. The generic BFF refuses every method under declared family
roots, including reserved `/api/v1/product-access`; only typed routes expose
organization operations. Classification uses the final upstream URL, configured
API base prefix, segment boundaries and bounded security normalization. It does
not rewrite IDs or outgoing URLs. Malformed encodings and ambiguous traversal or
encoded separators fail closed before cookie/vault/refresh/fetch work. Next may
normalize repeated slashes or backslashes before Route Handler dispatch, returning
`308` to a same-origin canonical URL. That destination returns `404`, with zero
authority, vault, refresh or API work for all seven methods. This exception does
not allow another origin or a permissive canonical destination.

Coverage tests enumerate registered opted-in controllers and actual aliases and
check family closure. This is a scoped contract, not a global API registry. An
unmarked tenant module, an omitted business check, or an unsafe external rewrite
is outside that guarantee. Keep credential coverage and domain tests, including
a real write outside `/organizations`, tenant isolation and rollback.

## Browser and server transport

The foundation's dedicated GET routes are `/api/product-access/bootstrap`,
`/api/product-access/organizations?page=1` (fixed page size 20), and
`/api/product-access/organizations/:id/context`.
Member transport adds GET `/api/product-access/organizations/:id/members`
and GET/PATCH `/api/product-access/organizations/:id/members/:userId/roles`.
Unsupported methods explicitly return `405`; there is no implicit unfenced HEAD
response. Responses are private/no-store. Server Components call the entity's
`index.server.ts` DAL directly. See the [members contract](../product-admin/organization-members.md)
for request/response fields, byte limits and uncertain-write recovery.

Bootstrap returns `{binding, actor: {id, email}}`, with no domain request or
credential refresh. List/context and member calls require the bootstrap binding in
`X-AMCore-Context-Session`. It is a digest bound to the random login cookie ID and
actor, not a credential or an organization selection. Login/re-login changes it;
refresh/step-up vault version changes do not. Missing/malformed binding returns
`400` before vault/refresh work. A different captured identity returns `409`
`CONTEXT_SESSION_CHANGED` before refresh/domain work. Reload/bootstrap the current
identity and explicitly resume the desired operation; do not replay stale writes.

The typed executor captures one session and reuses its first vault read with
the existing refresh single-flight/CAS protocol. It strips browser credentials,
organization and binding headers and rebuilds the declared upstream selector.
Fresh selected operations issue zero switches, one domain call and zero refreshes;
a refresh-needed operation uses the existing one-refresh path. Five seconds bounds
waiting through vault, refresh, fetch and response-body parsing. If a supplied
caller signal aborts, publication retires. Shared refresh may safely finish CAS
after retirement; a completed SQL write is not undone. Infrastructure/deadline
failure uses the existing safe `503` transport response.

Operation descriptors (method, fixed path, schema and target) are owned by code,
not supplied as browser URLs. Add typed mutation wrappers with the existing
origin guard and strict input validation. A consumer owns its publication lease;
retired responses must not update another identity's cache, callback or toast.
There is no server-global active organization or dependency on Console pages.

Member PATCH uses the shared web-owned Origin policy: an exact trusted-origin
check, an origin-reduced Referer fallback, and allowance when both headers are
absent for non-browser callers. See [CSRF posture](./csrf.md) for this boundary.
It requires JSON content type, no query parameters and no Content-Encoding. Its strict body is
`{expectedMemberId, expectedAclVersion, roleIds}`. Successful reads and writes
return `{binding, data}` through the BFF; the direct API returns the DTO without
that envelope. Browser clients use their session cookie and binding, never a
browser-held bearer token. Use the public member hooks to preserve identity
fencing and distinguish acknowledged, rejected and unknown write outcomes.

See [RBAC](./rbac.md), [API consumption](../frontend/api-consumption.md),
[FSD guardrails](../frontend/fsd-boundaries-and-guardrails.md), and
[managed local checks](../operations/local-stands.md).

For ready pages and custom UI, see [product administration](../product-admin/README.md).
