# Place product administration and choose its session boundary

Use path mode for one shared website/admin login. Use a separate HTTPS hostname
when a buyer and an administrator must stay signed in independently.
Organization membership and permissions still control access on the API.
The public login form does not grant administrative access.

## Public addresses

The checked-in source is `packages/shared/src/config/product-admin.json`:

```json
{ "version": 1, "mode": "path", "alias": "manage" }
```

With website `https://shop.example.com`, the default Russian addresses are:

| Journey          | Path mode                      | Host mode, `https://manage.shop.example.com` |
| ---------------- | ------------------------------ | -------------------------------------------- |
| Login            | `/ru/manage/login`             | `/ru/login`                                  |
| Organizations    | `/ru/manage/organizations`     | `/ru/organizations`                          |
| Own keys         | `/ru/manage/settings/api-keys` | `/ru/settings/api-keys`                      |
| Sessions         | `/ru/manage/settings/sessions` | `/ru/settings/sessions`                      |
| OAuth completion | `/ru/manage/auth/callback`     | `/ru/auth/callback`                          |
| Recovery         | `/ru/manage/forgot-password`   | `/ru/forgot-password`                        |
| Invitation entry | `/ru/manage/invite/accept`     | `/ru/invite/accept`                          |

Single-locale builds omit `/ru`. The physical Next route subtree remains
`apps/web/src/app/[locale]/(product-admin)/manage/` in both modes. The edge maps
public host-mode pages to that physical prefix; visitors cannot open the prefix
on either public host. Keep the standalone Next server behind the trusted edge.
Host mode returns 404 for that physical prefix; it does not redirect visitors.
Unknown staff page suffixes return 404. A missing organization uses the safe
unavailable page; streamed Next responses can already have HTTP status 200.

## Configure or move the administration area

1. Choose `path` or `host` and a lowercase, single-segment alias in the JSON source.
   Preflight an alias with `node scripts/check-product-admin-placement.mjs --alias=office`.
   Locale names, API/assets roots, route collisions and Console collisions are refused.
2. When changing the alias, move the entire physical `manage` directory to the
   selected alias in the same change. Keep route-group ownership and all children.
   Do not merely change a runtime environment variable or add a redirecting copy.
3. Set `FRONTEND_URL` to the exact canonical website origin on both API and web.
   For host mode, set `PRODUCT_ADMIN_ORIGIN` to the exact HTTPS admin origin on both.
   Set the same confidential `WEB_FRONTEND_CONTEXT_KEY` on both services, at least
   32 characters. Generate it, for example, with `openssl rand -hex 32`.
4. Run `node scripts/render-product-admin-edge.mjs --write`, then
   `node scripts/check-product-admin-placement.mjs`. Review the generated Caddy
   and nginx snippets under `docker/`. Path mode needs no separate-host mapping.
5. Rebuild shared, API and web artifacts from the same source configuration.
   Deploy the matching edge mapping, runtime origins and confidential key together.
   Configure DNS/TLS and same-origin trusted-origin allowlists before exposing traffic.

```text
Placement source -> physical routes + generated edge -> matching API/web builds
                                                        |
Browser -> selected public hostname -> selected session -> API permission checks
```

Host mode requires different normalized hostnames for website, admin and any
separate Console host, regardless of port. `https://shop.example.com:443` and
`https://shop.example.com:9443` cannot isolate cookies and are rejected as separate
frontends. Origins include scheme and effective port; extra ports are not aliases.
The Operations Console `--admin-console` initializer choice remains independent.
There is no new product-admin initializer flag.

## Session and account behavior

Path mode shares the website's opaque `amcore_session` cookie and backend session.
Logging out from the website or administration also logs out the other area.
Host mode uses `__Host-amcore_staff_session`: Secure, HttpOnly, SameSite=Strict,
Path=/, with no Domain attribute. Its Redis vault and refresh locks are separate
from website and Console vaults. Ordinary website logout preserves staff login;
ordinary staff logout preserves website login. Both preserve a Console session
on its own hostname. A Console in the website's
path shares the website session; website logout also logs out that Console.

The same person can use the same account or different accounts across hosts.
This does not create a second password or duplicate organization membership.
Password reset revokes every backend session of that account. **Revoke other
sessions** keeps only the current backend session and revokes that account's
other sessions, including website, staff and Console sessions. Sessions belonging
to a different account are unaffected. These are broader account actions.
Previously admitted API requests may finish after logout or a permission change.

The sidebar collapses to icons with localized tooltips. Dashboard comes first.
The website link is at the bottom and preserves the active language. Pages use
the available width; the account menu stays in the header. Active sessions use
the shared table surface; revocation still requires explicit confirmation.

## Login, invitations and safe recovery

An anonymous protected request opens the selected login and retains an allowlisted
page destination. Free registration is not offered on the admin login. Configured
Google, GitHub and Apple methods can sign in existing accounts. An ordinary admin
OAuth login cannot silently create a new account. Telegram remains link-only.
Provider callbacks and email destinations follow the selected frontend; see
[OAuth](../auth/oauth.md) and [invitations](../auth/invites.md).

External sign-in briefly shows “Completing sign-in…” and continues automatically.
Continue also works without JavaScript. The completion document keeps the chosen
language and posts to its selected same-origin endpoint. Its strict-origin policy
sends no ticket in Referer; other secret routes retain no-referrer. Keep the
[OAuth completion transport](../auth/oauth.md#how-oauth-login-works) and public edge headers
aligned when customizing routes. A definitive expired attempt returns to login;
invitation unknown-result recovery retains its established protocol.

Invitation-bound signup is available before membership, even when ordinary signup
is closed. Only accepting the invitation grants its intended membership. The API
checks invitation identity, current membership and permissions independently.

After a server refusal, the unavailable page shows no organization name or tabs.
Use **All organizations** to open an explicit list, **Go to website**, or **Log out**
to choose another account. Logout works without fetching the denied organization
or profile. A fixed-shop integration can hide the organization-list action.
The page explains whether logout also affects the website. It never silently
selects another organization to recover from a refused deep link.

## Existing installations and coordinated changes

Old organization and own-key page addresses issue 308 redirects to the configured
public admin address. Only supported list filters survive. Existing site login,
sessions and previously issued root email/invitation links retain their site flow.
New organization invitations target admin. Direct native API clients can retain
their existing token/cookie contract; the confidential web proof is not an auth grant.

Changing placement invalidates new frontend-bound invitation/token/OAuth state.
Finish or restart these journeys instead of moving bearer credentials in redirects.
Ordinary auth can atomically retire stale invitation projections without extending
their expiry or reopening a flow. Existing live-flow surface checks remain strict.
Keep legacy invitation storage until its maximum lifetime has drained.
Existing product vault records without an audience remain product-only; staff and
Console vaults require their own audience before reads, refresh or publication.

Deploy matching source, edge and environment atomically or stop affected traffic
while switching. A mismatched placement proof fails closed before auth effects.
For rollback restore the matching artifact/configuration set, not only the edge.
Do not share cookies with `Domain`, copy tokens across hosts, or expose the hop key.

## Local development and verification

Native web dev uses port 3002. Supply its runtime variables through the web process
or a gitignored `apps/web/.env.local`; Turbo does not load the repository `.env` for
web automatically. Keep API/web `FRONTEND_URL` and the confidential key identical.
The Compose web port is 3000. When using a native-development `.env`, explicitly
override both `FRONTEND_URL=http://localhost:3000` and
`WEB_TRUSTED_ORIGINS=http://localhost:3000` for `docker compose up`.

Use [managed stands](../operations/local-stands.md) for maintainer previews and
runtime checks. HTTPS stands use a test CA; ordinary browsers must separately
trust the API address to display API-hosted avatars. Production needs valid TLS.
Provider mocks alone cannot prove ID-token signature validation. Keep signed
protocol fixtures, browser callbacks, invitation publication and real-provider
registration checks distinct. A local protocol fixture is not a live Apple login.
