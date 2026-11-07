---
name: amcore-data-patterns
description: Choose and apply AMCore frontend data patterns when adding, changing, or reviewing server reads, Query hooks, editable forms, mutations, or session-owned caches. Use in AMCore and its downstream forks. Excludes backend-only work and presentation-only changes.
---

# AMCore frontend data patterns

Use the smallest existing pattern that satisfies the feature's behavior.
This skill applies the public data contract; it does not change that contract
or authorize a migration of unrelated consumers.

## Start from the data owner

Read [Data ownership for interactive pages](../../../docs/frontend/api-consumption.md#data-ownership-for-interactive-pages).
Choose per resource, not once for the entire page:

| Need                                                                      | Pattern                 | Starting point                                             |
| ------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------- |
| Display data updated through URL navigation or route refresh              | Server display          | Existing server DAL and Server Component                   |
| Interactive list, editable resource or browser refresh                    | Ordinary Query          | Typed transport, Query hook, local form input              |
| Additional authorization, secret handling or uncertain-operation recovery | Query with domain rules | Existing domain hooks and controllers, only where required |

Keep correct server consumers. Do not convert them to Query for visual uniformity.
Server preloading is a separate, optional choice for an interactive resource.
It is not a fourth pattern or a prerequisite for every form.

## Apply the selected pattern

1. Inspect the existing consumer, typed transport and public slice exports.
   Identify the resource owner, response inputs and dependencies changed by a write.
2. Read the relevant recipe below and reuse its maintained implementation.
3. Keep Query responsible for browser server data, loading, errors and cache.
   Keep input, selection and dismissal local. Do not add a second loader or cache.
4. Verify the changed behavior with the smallest relevant checks under the
   [frontend testing guide](../../../docs/frontend/testing.md).
   Report the selected pattern, any necessary domain rule, and verification limits.

### Server display

Follow the [server request boundary](../../../docs/frontend/api-consumption.md#server-request-boundary).
Use the existing server DAL/transport rather than calling the browser BFF from
the server. Preserve its authentication and unavailable/not-found handling.
For optional Query hydration, use request-local state and identical server/browser
keys. Serialize only safe data; never introduce a server QueryClient singleton.

### Ordinary Query

Start with [the ordinary resource example](../../../docs/frontend/api-consumption.md#start-with-an-ordinary-resource).
It uses existing notification-preference hooks; it is not a shipped screen.
Reuse the host's QueryClientProvider. Standalone consumers must supply one.

- Include response-changing inputs in keys. For personal data, follow
  [personal data and session changes](../../../docs/frontend/api-consumption.md#personal-data-and-session-changes).
  Reuse the confirmed owner and key factories. User ID alone does not identify
  a session. Do not replace the stable current-user bootstrap key.
- Keep mutations attached to their initiating session. Late results must not
  alter a replacement session's cache. Reuse existing ownership helpers;
  cancellation does not undo a server write.
- Capture a draft when editing starts. Same-owner background refresh must not
  reset unfinished input. Drop the old owner's draft when ownership changes.
- Refresh the write's actual dependencies using the captured owner's keys.
  A confirmed write remains successful if the following GET fails or stalls.
  Recover the read without repeating the write. Do not automatically replay
  writes with unknown outcomes.
- Do not copy organization authority checks, version review or operation journals
  into an ordinary form without a concrete API or product requirement.

For identity suggestions, use the [existing lookup recipe](../../../docs/frontend/api-consumption.md#short-lived-identity-suggestions).
For SSE, AI actions or paused mutations, read the relevant section of that guide
and inspect its existing hooks before extending the session lifecycle.

### Query with domain rules

Read [organization access requirements](../../../docs/frontend/api-consumption.md#organization-access-additional-domain-requirements)
when extending organization consumers. Other domains keep their own contracts.
Query still owns reads; the domain owns admission and operation rules.
Preserve server authorization, first-action readiness, cooldown and unknown-result
recovery where the existing contract requires them. Cached data is not permission.
An aborted read is not a successful freshness review. Preserve form intent during
authority revalidation and update the dependencies named by the domain contract.

## Keep the change bounded

Use public slice exports and the existing transport. Do not create a universal
fetcher, extra QueryClient or new controller merely to make consumers look alike.
Follow repository instructions for Next.js references, UI checks and delivery.
Keep contract examples in the linked public guides, not copied into this skill.
All links are relative to this skill directory; the repository is three levels up.
