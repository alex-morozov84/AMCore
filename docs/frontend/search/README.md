# Frontend search

AMCore supplies a controlled search field and a draft controller. A feature
decides where results come from and how its URL or API request is built. Start
here when adding search to a downstream product; neither shared primitive
depends on the optional Operations Console.

## Contents

- [Choose a pattern](#choose-a-pattern)
- [Shared primitives](./shared-primitives.md) — exact props, local filtering,
  debounce, reconciliation, and limits.
- [URL-backed search](./url-backed-search.md) — a typed feature-owned Next
  adapter for a search box and sort link, including GET fallback.
- [Navigation and verification](./navigation-and-verification.md) — feature
  links, race ordering, Back/Forward limits, and a test checklist.
- [Before shipping](#before-shipping)

## Choose a pattern

| Need                                                      | Use                                                                               | Keep in the feature                                                           |
| --------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Filter an already-loaded list in this tab                 | `SearchField` and local state                                                     | Matching rules and result rendering                                           |
| Search server results represented by the page URL         | `SearchField` and `useDebouncedDraft`                                             | URL/query parsing, canonical identity, navigation, results, and fallback form |
| Search through an API that may apply superseded responses | `SearchField`; add the draft controller only after enforcing latest-response-wins | Request cancellation or response ordering, API errors, and result state       |

The draft controller requires **last-navigation-wins** behavior from its
caller. The shipped Next.js 16.3.5 App Router discards a pending navigation
when a newer navigation or Back/Forward restore starts. A transport that can
apply every old response does not satisfy that contract on its own.

## Before shipping

- Parse and validate URL/API inputs on the server; pass the canonical search,
  sort, and page to the client adapter. Include every field that changes the
  displayed view in the identity.
- Supply localized `label`, `placeholder`, clear, and submit text. Use
  `RouteProgressLink` for internal links and `useRouteProgressRouter()` for
  programmatic navigation; see the [route-progress guide](../route-progress.md)
  for their full contract.
- Keep an actual GET form and link `href`s if search must work without
  JavaScript. A client event handler alone is not a fallback.
- Test rapid typing followed by sort/page navigation, external URL changes,
  clear/refocus, keyboard use, and the no-JavaScript form. The
  [verification guide](./navigation-and-verification.md#verify-the-feature) gives the
  concrete checks.

The Operations Console uses these primitives through its own discovery
adapter. Its search parameter names, 255-character limit, sort allowlists,
and page-reset rules are examples of **feature policy**, not shared defaults.
The scaffold acceptance contract for `--admin-console=disabled` is to keep
the shared primitives while removing that Console adapter; generated output
must be verified before delivery.
