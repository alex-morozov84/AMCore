---
name: amcore-frontend-page
description: Add or redesign an AMCore page, product card or user journey, or change interactions such as editing and saving. Label-only edits and isolated shared primitives follow AGENTS.md.
---

# AMCore frontend pages

Read PROJECT_CONTEXT.md and applicable checkout instructions.

## Redesign or change interactions on an existing page or card

Read [shared UI](../../../docs/frontend/shared-ui-and-shadcn.md),
[theme tokens](../../../docs/frontend/brand-theme-and-tokens.md#token-architecture)
and the [FSD boundaries](../../../docs/frontend/fsd-boundaries-and-guardrails.md).
Reuse existing controls and semantic tokens. Keep the route, FSD slice
and data ownership in place for appearance-only changes. Preserve import
boundaries and use public entry points when adding imports. A label-only edit
follows the checkout's AGENTS.md.

Use [component organization](../../../docs/frontend/architecture-and-conventions.md#component-organization)
before extracting a component. Justify it by independent behavior, state or
reuse. A small private visual piece can stay with its parent. If editing and
saving are part of the request, inspect the current component and its caller
to see where the fields, state and save logic live. Choose whether to keep
the form inside the component or extract it. Either is valid. Briefly explain
the choice using the existing code. Use
[data-patterns](../amcore-data-patterns/SKILL.md) for form state and mutation.

Use the [UX checklist](../../../docs/frontend/ux-checklist.md) and
[runtime verification](../../../docs/frontend/testing.md#dev-workflow-verifying-a-change-at-runtime).
Plan a browser check of the changed view at affected widths and themes. For
editing, include save success, errors and the resulting visible state.

## Add a route or materially change a journey

Read the [route recipe](../../../docs/frontend/architecture-and-conventions.md#the-recipe--adding-a-route)
and [UI/UX checklist](../../../docs/frontend/ux-checklist.md). For changed Next
routing, rendering or metadata, read the installed Next docs named by AGENTS.md.

1. Name the user, page purpose and visible result. Choose public or private with
   [indexing guidance](../../../docs/frontend/seo.md). Verify current session and
   domain authority for protected data. Use admin-placement when changing
   administration placement or host sessions.
2. Keep route plumbing thin and compose the page through FSD public entries.
   Keep the server boundary unless an interactive leaf needs a client. Use
   data-patterns for data ownership, forms and mutations.
3. Reuse [shared controls](../../../docs/frontend/shared-ui-and-shadcn.md).
   Apply localized copy, accessible semantics, focus and recovery. Check
   [CSP and rendering](../../../docs/frontend/browser-security-and-csp.md)
   when introducing third-party resources or changing the rendering strategy.
   For list search, read the [search overview](../../../docs/frontend/search/README.md)
   before choosing local or URL-backed results. For URL-backed search, read the
   [adapter](../../../docs/frontend/search/url-backed-search.md) and
   [navigation rules](../../../docs/frontend/search/navigation-and-verification.md).
   Preserve canonical view identity, navigation ordering and the native GET fallback
   where required. Use data-patterns for a suggestion picker or browser-owned resource.
   For public pages with search or pagination, inspect the actual response HTML
   and HTTP status codes using the [SEO verification guide](../../../docs/frontend/seo.md).
4. Plan the smallest [runtime checks](../../../docs/frontend/testing.md) for
   the changed journey. Include the affected language, narrow layout and
   keyboard path. Report actual checks and gaps. Obtain separate authority for
   any managed stand or other execution that requires it.
