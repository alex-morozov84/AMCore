# Extend product administration modules

Use the organization foundation as the worked pattern. Keep reusable domain data,
typed operations and lifecycle state below ready UI; application composition owns
a module's ordinary destinations, menu insertion and physical routes. A custom
headless consumer imports its public entity contract and shared primitives, never
ready pages or shell. The server entry is explicit and cannot enter client code.

## Ownership and dependencies

| Surface                                               | Responsibility and removal boundary                                                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Common auth/BFF/shared context family                 | Retained safety and API contracts; generic family denial remains even when reference UI is omitted                       |
| `_app/product-api`                                    | Retained application family registration, imported directly from shared contract rather than a frontend entity barrel    |
| `entities/organization-context`                       | Independent public headless client behavior/server DAL; retain while downstream custom consumers need it                 |
| Selector feature/summary widget/ready page            | Editable reference UI; no imports from headless behavior back to them                                                    |
| Organization mount/frame/menu                         | Application composition; separate server content, client menu and universal placement entries                            |
| Physical routes/menu insertions/messages/stories/docs | Mixed contributions: remove only exclusively owned entries, retaining other consumers and discovery                      |
| AppShell/shared UI                                    | Shared presentation; remains available for other product consumers, independent of organization reference UI and Console |

The slice's named `index.server.ts`, `index.client.ts` and `index.config.ts`
entries are allowed only from Next application wiring. Its compatibility index
still exports the original symbols and has a mixed source graph. Keep the new
capability entries narrow and imports relative inside composition. Their server,
client and universal claims must hold through transitive reexports as well as
ordinary imports.

Reference-only omission must preserve typed context routes, headless consumers and
retained generic family closure. Removing Console via its initializer does not
remove product context. No product-admin/headless-only initializer flag is supplied;
a custom omission needs its own dependency inventory, source and runtime proof.

## Adding a later module

The members module derives `membersHref(id)` from the same app-owned placement
source and reuses the explicit selected organization contract. Its ready mount
and public headless hooks are described in [organization members](organization-members.md). Invitations, keys and settings do not
need to share a forced administration prefix. Do not introduce a global navigation
registry or universal admin provider for ordinary composition.

Each later module review checks:

- Public imports and capability boundaries; headless has no reference/shell dependency.
- Both ready and different custom-UI consumption, sharing domain operations.
- One composition source for direct links, menu, pagination and recovery destinations.
- Missing/changed session, unavailable organization, loading/error and authorization limits.
- Retained safety, mixed ownership/removal, catalogue/story/test dependencies.
- Updated product-admin discovery and executed integration examples.

## Acceptance for the first mutation module

The members module is the first mutation module. Each additional write slice must supply a code-owned
typed operation with binding, target and signal; strict BFF input and Origin checks;
and each operation's actual response, including `204` without a JSON body.

Expose reusable pending, structured error and action state without headless
redirects or toasts. Guard late success **and failure** after identity/target
retirement. Explicitly reread context/capabilities after success: a disabled Query
observer using `skipToken` does not refetch through `invalidateQueries()`.
Distinguish a committed write followed by failed reread from a failed write. Never
blindly retry an ambiguous write; retirement cannot undo committed SQL. Share one
context owner across related blocks. The members module supplies atomic assignment replacement; other management
journeys remain downstream-owned.
