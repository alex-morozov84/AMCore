# Search-engine indexing (SEO)

AMCore is closed to search engines by default. A product with public pages opens exactly the
production deployment and exactly the pages it chooses. A product without public pages, such as
an internal tool or a CRM, does nothing and stays closed.

This guide tells you what to do, why each rule exists, how to check it, and what breaks if you
ignore it. Rules are labelled **enforced** (a test or the start-up check fails when it breaks) or
**convention** (nothing fails; the guide and review are the control).

Paths such as `src/app/…` are relative to `apps/web`; message catalogues are
`apps/web/messages/<locale>.json`.

## Start here: your situation

| Your product                                                           | What to do                                                                                                                          |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Private application, internal tool, CRM                                | Nothing. Leave `WEB_SEO_INDEXING` and `WEB_SITE_ORIGIN` unset. Every page, the Console and `/api/*` stay closed.                    |
| Public site (shop, landing, docs) with a private application behind it | Follow [Make a page public](#make-a-page-public), then [open production](#open-production-and-keep-everything-else-closed).         |
| Public site that must be served from a CDN or statically               | The pages here are rendered per request (see [Rendering cost](#rendering-cost)). Put the public site in its own Next app or domain. |
| Staging, previews, local work                                          | Nothing. They stay closed even if production is open.                                                                               |

## How a request is decided

```
request
  │
  ▼
proxy: WEB_SEO_INDEXING=enabled
       AND WEB_SITE_ORIGIN is a usable origin
       AND the request Host equals that origin's host ?
  │ no                                     │ yes
  ▼                                        ▼
response gets                         no header is added; the page's own
X-Robots-Tag: noindex, nofollow       metadata decides
(closed; no page can reopen it)           │
                                          ├─ page built its metadata with buildPageMetadata
                                          │     → index, follow + canonical + hreflang + Open Graph
                                          └─ any other page
                                                → root default: noindex, nofollow
```

`/api/*` additionally carries a static `X-Robots-Tag: noindex, nofollow` from `next.config.ts`,
whatever the environment, because it never passes the proxy. The Console pages are closed by the
`noindex` metadata of the Console layout, which `htmlLimitedBots` delivers in `<head>` to every
listed crawler, and by the proxy header on every host that is not the open site host (in the `host`
topology that is the whole Console host). The Console has no static header of its own: its slug
lives in a Console-owned file that a fork without the Console deletes.

## Configuration

Both variables are read at run time, not at build time. One built image is therefore closed on
staging and open in production; promote the same image (see
[deployment](../operations/deployment.md)) and set the variables per environment. A running process
does not see a changed environment: restart or redeploy the web service after changing either
variable. No rebuild is needed.

| Variable           | Meaning                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WEB_SEO_INDEXING` | `enabled` or `disabled`. Empty or unset means `disabled`. Any other value stops the web service at start-up.                                                              |
| `WEB_SITE_ORIGIN`  | The public origin, for example `https://shop.example.com`: no path, no trailing slash. Used for canonical links, hreflang, Open Graph URLs, the sitemap and `robots.txt`. |

Set them wherever your deployment sets the environment of the web service (Compose `.env`, your
orchestrator or CI environment; see [deployment](../operations/deployment.md)).
`WEB_TRUSTED_ORIGINS` is a comma-separated list of exact origins (`https://shop.example.com`, no
trailing slash), the same list the browser CSRF guard uses.

With `enabled`, the web service checks at start-up that `WEB_SITE_ORIGIN` is set, canonical and
`https`, and also listed in `WEB_TRUSTED_ORIGINS`; otherwise it stops with a message naming the
variable. With `disabled` it never stops. Keep the API's `FRONTEND_URL` equal to
`WEB_SITE_ORIGIN`: email and OAuth links use one, canonical links use the other, and nothing can
check that they match.

### What each environment returns

| Environment                                                                   | `X-Robots-Tag` on pages | `robots.txt`                                                     | `sitemap.xml`                     |
| ----------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------- | --------------------------------- |
| Local dev, staging, preview (variables unset)                                 | `noindex, nofollow`     | allows crawling, no `Sitemap:` line                              | 404                               |
| Production, `enabled`, request on the site host                               | none                    | allows crawling; `Sitemap:` line only if public pages are listed | 200 if pages are listed, else 404 |
| Production, `enabled`, request on another host (`www` alias, raw IP, preview) | `noindex, nofollow`     | allows crawling, no `Sitemap:` line                              | 404                               |
| Console host (`host` topology)                                                | `noindex, nofollow`     | same as above                                                    | 404                               |

## Make a page public

1. **Decide the page is public.** Anyone, including a crawler, may read it. A page that shows
   account data is not public.
2. **Create it in a route group of its own, outside the private ones.** Never put it in `(auth)`,
   `(dashboard)`, `(organization-access)` or `admin` (see [Make a page private](#make-a-page-private)
   for what they are). `(site)` below is only an example name: create the folder
   `src/app/[locale]/(site)/`. It needs no `layout.tsx` of its own. The page inherits the root
   `[locale]` layout (fonts, theme, providers, the CSP nonce) and gets no app shell and no sign-in
   check. A route group does not decide indexing, the page's metadata does: a page in a new group is
   closed until it calls `buildPageMetadata` (this is also why a `(crm)` group is private by default).
   The home page `/en` is the signed-in dashboard in this starter; a product with a public landing
   page restructures that route first.
3. **Write the route and build its metadata with the helper.** The route file stays thin; compose
   the page in `src/_pages/pricing` like any other page (see the
   [architecture guide](./architecture-and-conventions.md)). Never write a `robots` key yourself.

   ```tsx
   // src/app/[locale]/(site)/pricing/page.tsx
   import type { Metadata } from 'next'
   import { getTranslations, setRequestLocale } from 'next-intl/server'

   import { PricingPage } from '@/_pages/pricing'
   import { resolveLocaleParam } from '@/i18n/params'
   import { buildPageMetadata } from '@/shared/lib/seo/page-metadata'

   type Props = { params: Promise<{ locale: string }> }

   export async function generateMetadata({ params }: Props): Promise<Metadata> {
     const locale = await resolveLocaleParam(params)
     const t = await getTranslations({ locale, namespace: 'pricing' })
     return buildPageMetadata({
       locale,
       path: '/pricing',
       title: t('title'),
       description: t('description'),
     })
   }

   export default async function Pricing({ params }: Props) {
     setRequestLocale(await resolveLocaleParam(params))
     return <PricingPage />
   }
   ```

   `path` has no locale prefix and no query. Pass the page's own title (`Pricing`): the root layout
   appends ` | <site name>` through its title template, so do not add the site name yourself. The
   helper builds the absolute, locale-prefixed canonical URL, the language variants with
   `x-default`, Open Graph and Twitter data, and opens the page only when indexing is effective.
   Add the `pricing.*` message keys to every catalogue. `src/_pages/pricing/index.ts` re-exports
   `PricingPage` from `PricingPage/index.ts`, which re-exports `PricingPage/PricingPage.tsx`: the
   same shape as `src/_pages/dashboard/DashboardPage/`. An unsupported
   locale segment such as `/de/pricing` ends in a 404 (`resolveLocaleParam` calls `notFound()`), so it
   adds no URL to the index. In a fork scaffolded with one locale the
   route has no `[locale]` folder and no `params`: pass `DEFAULT_LOCALE` from `@amcore/shared` as
   `locale`; URLs have no prefix and no language variants are published.

4. **List the page** in `src/_app/seo/public-pages.ts`, which ships returning an empty list:

   ```ts
   export async function getPublicPages() {
     return [{ path: '/pricing' }, { path: '/about', changeFrequency: 'monthly' as const }]
   }
   ```

   The function is `async`, so a product can read its pages from a database. The sitemap is built
   only from this list. Do not list the home page (`path: ''`) while `/en` is still the signed-in
   dashboard: that would put a private, `noindex` page in the sitemap. **Convention:** a listed
   page must also use the helper. A listed page that forgot it stays `noindex` (safe) but appears in
   the sitemap, which Search Console reports as a warning. A page that uses the helper but is not
   listed is indexable and missing from the sitemap.

5. **Optional structured data**, inside the page component:

   ```tsx
   import { getTranslations } from 'next-intl/server'

   import { JsonLd } from '@/shared/lib/seo/json-ld'

   export async function PricingPage() {
     const t = await getTranslations('pricing')
     return (
       <main>
         <JsonLd
           data={{ '@context': 'https://schema.org', '@type': 'Product', name: t('title') }}
         />
         {/* page content */}
       </main>
     )
   }
   ```

   Text in structured data is user-facing text: take it from the message catalogues like any other.
   The component escapes every `<` so a value cannot close the script tag. Check the result with
   Google's Rich Results Test. Links from a public page to the login or application pages need no
   `nofollow`: those pages are `noindex`.

6. **Test it if you want a browser test.** `e2e/mocked/seo-headers.spec.ts` covers the closed
   defaults. A product adds its own test for its public pages.

## Make a page private

A private page needs nothing for search engines: the whole app is closed by default.

1. **Choose the group by purpose.** `(dashboard)` is the signed-in application shell (sidebar,
   account menu). `(organization-access)` holds organization pages. `(auth)` holds the forms for
   signed-out visitors (login, registration, password reset, invitations): it is **not** the group
   for "pages behind login". `admin` is the Operations Console.
2. **Noindex is not access control.** A group does not protect a page: its layout is only a shell.
   Every page that shows account data must check the session itself with `requireSession()` from
   `@/shared/api/bff/dal`, as the existing `(dashboard)` pages do. A signed-out visitor is
   redirected to the localized login page; if the session store is unavailable it raises an error
   instead. Search-engine rules hide a page from search results; they do not stop anyone who has
   the URL.
3. **Metadata.** Give the page a `title` (and `description`) as usual and set nothing else about
   robots: it inherits the root `noindex`.

   ```ts
   export async function generateMetadata({ params }: Props): Promise<Metadata> {
     const locale = await resolveLocaleParam(params)
     const t = await getTranslations({ locale, namespace: 'billing' })
     return { title: t('title') } // inherits the root noindex; no robots key
   }
   ```

   Do not call `buildPageMetadata`, which opens a page when indexing is enabled. To be explicit,
   add the sanctioned object: `return { ...noindexMetadata, title: t('title') }`, or
   `export const metadata = noindexMetadata` for a page with a fixed title, with `noindexMetadata`
   from `@/shared/lib/seo/page-metadata`. Spreading `noindexMetadata` is allowed; what the guard
   rejects is writing a `robots` key yourself. Setting `openGraph`, `twitter` or `alternates` on a
   private page changes nothing for indexing.

4. **Check it.** On a closed site `curl -sI` shows `X-Robots-Tag: noindex, nofollow`; on the open
   site host check the `<meta name="robots">` tag with the body command in [Verify](#verify).
   Without a session the page must redirect to the login page:
   `curl -sI https://shop.example.com/en/settings/billing | grep -iE '^HTTP|^location'` shows a
   redirect status and a `location` ending in `/en/login`.

## Open production and keep everything else closed

1. On the production web service, set `WEB_SEO_INDEXING=enabled` and
   `WEB_SITE_ORIGIN=https://<your public host>`, and make sure `WEB_TRUSTED_ORIGINS` contains the
   same origin.
2. Leave both unset on every other environment. A deployment is open only when it has both
   variables set to its own host; opening is always an explicit act there. Do not copy production's
   variables to staging: staging would then open. Search-engine rules are not access control, so
   also keep staging behind basic authentication or an IP allowlist.
3. Make the reverse proxy pass the public `Host` header unchanged (the bundled Caddy profile does).
   If a proxy rewrites it, the site stays closed (the safe direction); the verification block
   below shows it.
4. Verify with the block below, then register the site in Search Console and Yandex Webmaster.

### Try the open state locally

Open mode needs an `https` origin and a matching `Host` header, so a plain `localhost` run stays
closed. The managed stand can start the web service open (it adds the origin to the trusted origins
for you; run `pnpm stand down` first if a stand is already running, because a running stand refuses a
changed environment):

```bash
AMCORE_STAND_WEB_SITE_ORIGIN=https://shop.example.test \
AMCORE_STAND_WEB_SEO_INDEXING=enabled pnpm stand up
pnpm stand status                      # prints the stand's product URL, used as $STAND below
curl -sI -H 'Host: shop.example.test' $STAND/en/pricing | grep -i x-robots-tag    # nothing: open
curl -sI -H 'Host: other.example.test' $STAND/en/pricing | grep -i x-robots-tag   # noindex, nofollow
```

Without the stand, set both variables and `WEB_TRUSTED_ORIGINS` yourself on a production build and
use the same `-H 'Host: …'` trick. See [local stands](../operations/local-stands.md).

## Verify

Replace `https://shop.example.com` with your origin. Run groups 1 to 5 against production, and groups
1 and 2 against staging. If staging is behind basic authentication, add credentials
(`curl -u user:password …`) or run from an allowed address: a bare `401` from the proxy carries no
`X-Robots-Tag` and proves nothing. Each header command prints the status line first, so a missing
`x-robots-tag` line next to `HTTP/… 200` means the header is absent (the open state), while no output
at all means there was no response.

```bash
# 1. Pages: no X-Robots-Tag on the site host when open; noindex on every other host.
curl -sI https://shop.example.com/en/pricing | grep -iE '^HTTP|x-robots-tag'
curl -sI https://staging.example.com/en/pricing | grep -iE '^HTTP|x-robots-tag'   # expect noindex, nofollow

# 2. A private page and the API stay closed.
curl -s -A 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' \
  https://shop.example.com/en/login | grep -oE '<meta name="robots"[^>]*>'   # expect noindex, nofollow
curl -sI https://shop.example.com/api/auth/sessions | grep -iE '^HTTP|x-robots-tag' # expect noindex, nofollow

# 3. Crawler files.
curl -s https://shop.example.com/robots.txt
curl -sI https://shop.example.com/sitemap.xml | head -1                    # 200, or 404 with no listed pages

# 4. The Operations Console (path topology; `admin` is the default slug, see the Console guide).
curl -s -A 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' \
  https://shop.example.com/en/admin/login | grep -oE '<meta name="robots"[^>]*>'   # expect noindex, nofollow

# 5. Googlebot must receive the tags inside <head>, even when generateMetadata is slow.
curl -s -A 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' \
  https://shop.example.com/en/pricing |
  sed 's#</head>.*##' |
  grep -oE '<(link rel="(canonical|alternate)"|meta name="robots")[^>]*>'
```

The Googlebot command (group 5) must print the `canonical` link, one `alternate` link per locale plus
`x-default`, and the `robots` meta tag. Repeat it with
`-A 'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)'`. To prove the slow case on
your own page, make its `generateMetadata` wait one second and run it again: a missing tag means
the tags were streamed into the page body, where Google does not accept them.

## Rules, reasons and consequences

| Rule                                                                                                                          | Why                                                                                                                                                                                                                                    | Check                                                                                                              | If ignored                                                                                                    | Status                              |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Only `shared/lib/seo` writes a `robots` metadata key.                                                                         | Metadata merges shallowly: a page's `robots` object replaces the layout's whole object, so `'index, follow'`, `{ googleBot: { index: true } }` or `{ nocache: true }` reopen indexing without `index: true`.                           | `robots-key-guard.test.ts` scans all sources and proves itself on each forbidden form.                             | A page silently becomes indexable.                                                                            | Enforced                            |
| Close with `noindexMetadata`, open with `buildPageMetadata`.                                                                  | They return complete objects (`robots`, `openGraph`, `twitter`, `alternates`) so nothing is inherited by accident.                                                                                                                     | `page-metadata.test.ts`.                                                                                           | A hand-written object drops inherited fields (Open Graph site name, canonical, hreflang) or reopens indexing. | Enforced                            |
| The proxy only adds `X-Robots-Tag`, never removes it.                                                                         | Next applies `next.config.ts` headers first and the proxy after; a static header must survive.                                                                                                                                         | `indexing.test.ts`.                                                                                                | A closed surface could be reopened by the proxy.                                                              | Enforced                            |
| Indexing needs the exact site host. Only `Host` is read, never `X-Forwarded-Host`.                                            | The same image must stay closed on staging, aliases, raw IPs and the Console host.                                                                                                                                                     | `indexing.test.ts`.                                                                                                | A client could open a closed host with a forged header.                                                       | Enforced                            |
| `enabled` with a missing, non-`https` or untrusted origin stops start-up.                                                     | A misconfiguration the operator asked for must be loud, not a silently closed or wrongly open site.                                                                                                                                    | `site-origin.test.ts`.                                                                                             | Wrong canonical URLs or an unexpectedly closed site.                                                          | Enforced                            |
| `htmlLimitedBots` lists Googlebot.                                                                                            | For dynamic pages Next streams metadata into `<body>` unless the crawler is on this list; Google accepts `canonical` and hreflang only from `<head>`. Whether the tags reach `<head>` depends on how fast `generateMetadata` resolves. | `html-limited-bots.test.ts` requires exactly Next's default list plus the `Googlebot` token; verify group 5 above. | Tags land in `<body>` on slow pages and Google ignores them.                                                  | Enforced (list), manual (behaviour) |
| hreflang comes from `buildPageMetadata` and the sitemap, not next-intl's `Link` header (`alternateLinks: false`).             | The header is built from the request's own `x-forwarded-host` on every response, including private pages and 404s.                                                                                                                     | `routing.ts`; verify group 5.                                                                                      | Wrong hosts in hreflang behind a proxy; hreflang on private pages.                                            | Convention                          |
| `robots.txt` never lists private paths or the Console slug, and has no `Disallow`.                                            | A `Disallow` hides `noindex` from Google and Yandex, which must crawl a page to see it. Privacy comes from `noindex` plus authentication.                                                                                              | `crawler-files.test.ts`, `seo-headers.spec.ts`.                                                                    | Private URLs advertised; `noindex` never seen.                                                                | Enforced                            |
| `sitemap.xml` answers 404 when the site is closed or no pages are listed.                                                     | A closed product has no sitemap; an empty file only produces warnings.                                                                                                                                                                 | `seo-headers.spec.ts`.                                                                                             | Search Console warnings.                                                                                      | Enforced                            |
| A page that uses the helper is listed in `public-pages.ts`, and the reverse.                                                  | The sitemap is the one list of public URLs.                                                                                                                                                                                            | None: dynamic routes cannot be enumerated.                                                                         | Warning or a page missing from the sitemap.                                                                   | Convention                          |
| Do not use `locale` or `params` in the root layout's `generateMetadata` beyond the existing `getTranslations({ locale, … })`. | The single-locale scaffold transform deletes both there.                                                                                                                                                                               | The scaffold transform fails or leaves an undeclared name.                                                         | A forked project that chose one locale does not build.                                                        | Convention                          |

## Traps

- **Streamed metadata.** Fast metadata may reach `<head>`; slow metadata (a database read) goes to
  `<body>` for crawlers not on `htmlLimitedBots`. Test your own pages with the slow variant.
- **Merging.** A page that sets `openGraph`, `twitter`, `alternates` or `robots` replaces the
  layout's whole object. The root sets neither `alternates.canonical` nor `openGraph.url`, so a
  page that forgets them cannot inherit the home page's.
- **Forms that reopen indexing without `index: true`:** the string `'index, follow'`, a `googleBot`
  override, a partial object such as `{ nocache: true }`, a spread of an object of your own that
  contains `robots`, `other.robots`. The guard test rejects the `robots` key itself. Spreading
  `noindexMetadata` is fine: that is the sanctioned object.
- **`Disallow` hides `noindex`.** To remove a page from the index keep it crawlable and serve
  `noindex`.
- **Aliases and previews.** `www`, the apex, a raw IP and preview hosts are different hosts. Only
  the host in `WEB_SITE_ORIGIN` can be open; redirect the others to it.
- **A proxy that rewrites `Host`.** The site stays closed. Fix the proxy rather than reading
  `X-Forwarded-Host`.
- **`FRONTEND_URL` differs from `WEB_SITE_ORIGIN`.** Emails and canonical links then point to
  different hosts.
- **Static files.** `public/` assets and `manifest.webmanifest` bypass the proxy and carry no
  environment header; staging icons may appear in image search. They are brand assets and harmless.

## Rendering cost

Every page under the root layout is rendered per request, because the strict nonce-based CSP needs
a fresh nonce for each request (see [browser security and CSP](./browser-security-and-csp.md)).
This does not stop indexing: crawlers receive complete server-rendered HTML. It does mean no static
generation and no CDN caching of these pages. Skipping the CSP header for a public route group, as
the CSP guide describes, relaxes the policy only; the page stays dynamic because the root layout
still reads the request headers. For a large or high-traffic public site, run it as a separate
Next app or on a separate domain.

### If your public pages must be static

You have two options. Neither is a switch in this starter.

1. **Stay in this app.** Every page is rendered per request and answered with
   `Cache-Control: private, no-cache, no-store`, so a CDN will not cache it. Indexing is unaffected.
   This is enough for a modest public surface; spend the effort on the capacity of the web service.
2. **Move the public site out.** Run it as a second Next app, or on its own domain, behind the same
   reverse proxy: public hosts or paths go to it, the signed-in application goes to this app. Next
   describes the pattern as [multi-zones](https://nextjs.org/docs/app/guides/multi-zones). Then:
   - the public app has its own proxy and its own security-header choices, so it can serve static or
     cached pages with a policy suited to static content (the
     [CSP guide](./browser-security-and-csp.md) lists the trade-offs);
   - it owns its `robots.txt`, `sitemap.xml`, canonical links and hreflang. Set
     `WEB_SEO_INDEXING` and `WEB_SITE_ORIGIN` on **it**, in the way its own code reads them; this app
     stays closed;
   - the helpers in this guide live in this app (`shared/lib/seo`) and are not a shared package, so
     the public app copies them or you extract them first. The rules still apply to it: complete
     metadata objects, Googlebot's metadata in `<head>`, hreflang in the page head, no `Disallow` for
     private paths.

Only the first half was measured here: a public page with a relaxed policy stays dynamic under this
app's root layout. The separate-app route is described, not exercised, so test it on your
deployment (for example with the Verify block) before relying on it.

## Search Console and Yandex Webmaster

- Verify ownership with a DNS TXT record. It needs no code and no per-environment token.
- Google reads hreflang from page `<head>` links, an HTTP header or the sitemap. Yandex reads it
  only from `<link rel="alternate" hreflang>` in `<head>`, so the helper publishes it there.
  Yandex's crawler already gets `<head>` metadata from Next's default list; `htmlLimitedBots`
  adds Googlebot so Google gets it there too.
- Yandex `Clean-param` is expressed through the `other` field of a `robots.ts` rule; add it in
  `buildRobots` if your URLs carry tracking parameters. The `host` directive is not documented by
  Yandex today and is not emitted.
- To remove a leaked page: keep it crawlable, serve `noindex` (a closed environment already does),
  then use the removal tools in Search Console and Yandex Webmaster. Never add a `Disallow` first.

## Related

- [Browser security headers and CSP](./browser-security-and-csp.md): why pages are dynamic, and the
  route-scoping recipe.
- [Internationalisation and error localisation](./i18n-and-errors.md): locale routing and
  `localizedFrontendUrl`.
- [Deployment](../operations/deployment.md): promoting one image and the web environment variables.
