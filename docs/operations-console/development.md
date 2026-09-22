# Extending Operations Console

Read the [user guide](README.md) and [configuration and
deployment](configuration.md) first. The console is a `SUPER_ADMIN` system
control plane, never a product backoffice.

## Ownership and security boundaries

| Concern             | Owned location or rule                                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route plumbing      | Upstream: `apps/web/src/app/[locale]/admin/**`; scaffolding relocates or renames it for the selected locale mode and slug. Keep the resulting route thin. |
| Page composition    | `apps/web/src/_pages/console/**`                                                                                                                          |
| Shell               | `apps/web/src/widgets/console-shell/**`; reuse `shared/ui`, not the product app shell                                                                     |
| Console BFF         | `apps/web/src/app/api/console/**`; every handler starts with `withConsoleHostGuard()`                                                                     |
| Live page admission | `ConsolePageFrame` calls `requireSuperAdmin()` on every protected page before mounting chrome; never trust a JWT role snapshot or UI state                |
| Public navigation   | `RouteProgressLink` and the console public-href helper                                                                                                    |

Do not reuse console routes, BFF namespace, session audience, or `SUPER_ADMIN`
as shortcuts for a downstream product backoffice. Every backend data endpoint
must perform its own live `SUPER_ADMIN` authorization; the page-level admission
frame may mount chrome but never authorizes later data access.

The Users panel's system-role promote/demote action is the console's first
mutation, and its BFF plumbing is the reusable seam for the next one — don't
re-derive it from scratch:

- **Session/origin resolution** lives in
  `shared/api/console/authenticated-proxy.ts`
  (`resolveConsoleAccessToken`/`isConsoleRequestOriginTrusted`): it selects
  the isolated console vault and the strict console-host origin check in host
  mode, and the product session and `WEB_TRUSTED_ORIGINS` check in path mode.
  Every console mutation Route Handler resolves through this, not a
  hand-rolled per-mode branch.
- **Fixed public routes only.** A console mutation's Route Handler forwards
  to exactly one backend target it names itself — never a client-supplied
  path — and validates its request body against the same shared Zod schema
  the backend DTO uses, before forwarding. See
  `app/api/console/users/[id]/role/route.ts` for the reference shape.
- **Token containment.** If a mutation's upstream success response can ever
  carry a credential (an access/refresh token — `POST /auth/step-up` is the
  first and, so far, only example), its Route Handler must **not** stream
  that response back verbatim the way an ordinary mutation proxy does: read
  the body server-side, discard the credential entirely, and respond without
  it (`shared/api/console/step-up.ts` is the reference; it responds `204`).
  Getting this wrong hands a real backend bearer token to browser JavaScript
  — treat it as a security bug, not a style preference, and add a regression
  test asserting the response body never contains `accessToken`/
  `refreshToken` for any such route.
- **Step-up UX** stays a local, cohesive component beside the page that needs
  it (see `_pages/console/UsersPage/RoleStepUpDialog.tsx`) until a second
  console mutation needs the identical dialog — do not pre-emptively promote
  it to a shared/cross-slice widget before that second real consumer exists.

This preserves the [step-up re-authentication
boundary](../auth/sessions.md#step-up-re-authentication) for every future
dangerous action, in both topologies — the host-mode console-audience flow
this section previously called out as undesigned is now built and reviewed.

Console files added below the closed roots listed above are scaffold-owned
automatically. A Console contribution to shared navigation, config, scripts,
CI, or mixed docs must declare a narrow seam or structural operation. Novel
unmarked semantics remain an explicit author/reviewer classification boundary;
see the [worked ownership examples](../frontend/brand-theme-and-tokens.md#optional-feature-extension-ownership).

## Add a functional panel

1. Obtain a narrowly scoped plan and classify every datum as primary or
   secondary.
2. Inspect `ADMIN_CONSOLE_CONFIG` and the actual generated route tree; do not
   assume the upstream `[locale]/admin` path still exists.
3. Add thin route plumbing and `_pages/console` composition, using the existing
   shell and semantic tokens.
4. Add copy for every retained locale and progress-aware public navigation.
5. Choose the transport deliberately: a **read-only page with no client-side
   interactivity** (e.g. Organizations, Overview) can fetch straight from its Server
   Component via `shared/api/server`'s `fetchBackend()`, passing a
   console-aware `tokenResolver` (`shared/api/console/access-token.ts`'s
   `getConsoleAwareAccessToken`) instead of the product-session default —
   every protected page must render through `ConsolePageFrame`, because a
   persisted App Router layout is not a sufficient re-check on sibling
   navigation and must not retain chrome after denied/unavailable admission.
   The frame remounts the shell after an admitted sibling navigation, so it
   must also read the existing non-sensitive `sidebar_state` preference and
   pass it to `ConsoleShell`; this preserves the operator's collapsed/expanded
   choice without ever participating in admission. Pass the frame a
   page-specific skeleton that mirrors the final page's
   desktop and narrow-screen layout. Do not add a protected-route
   `loading.tsx`: it resolves outside the frame and can replace the shell
   before admission. No separate Route Handler is needed. A panel with any
   **browser-initiated** call (a mutation, a client-side poll, anything a
   `'use client'` component triggers after load) still needs its own handler
   under `app/api/console/**`, applying `withConsoleHostGuard()` explicitly,
   since that guard is a per-route-handler concern, not inherited from the
   page layout. Either way, independently authorize the corresponding backend
   endpoint — the admission frame mounts chrome, never grants data access. A
   mutation reuses the session/origin/token-containment seam described above
   under "Ownership and security boundaries" rather than a new one-off proxy.
6. Use the existing graceful-degradation primitives for secondary data. Keep
   primary failures explicit and fail privileged actions closed.
7. Add focused unit tests, Storybook/a11y states where applicable, and
   browser/real-stack coverage for auth, cookies, Redis, or proxy behavior.
8. Update the plain-language `SUPER_ADMIN` documentation in the same PR:
   purpose, statuses, actions, dangerous operations, and degraded/error states.

Do not describe the panel as available until its implementation and user
instructions ship together.

## Verification

- [Frontend testing](../frontend/testing.md) explains unit, Storybook, browser,
  and real-stack layers.
- Run `pnpm test:console-session-e2e` for the isolated HTTPS console
  cookie/Redis audience lane.
- Run `pnpm test:scripts` when the scaffold-owned surface or generated output
  changes; its single-locale host proxy smoke covers nginx and Caddy.
- Run `pnpm --filter web test:storybook` for component interaction and a11y
  states.
- Run `pnpm test:observability-contract` after tracked documentation changes.
- Follow the root `AGENTS.md` runtime-verification rule for Next.js behavior.
