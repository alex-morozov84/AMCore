# Search-engine indexing (SEO)

AMCore is closed to search engines by default. A product with public pages opens exactly the
production deployment and exactly the pages it chooses. A product without public pages, such as
an internal tool or a CRM, does nothing and stays closed.

This guide tells you what to do, why each rule exists, how to check it, and what breaks if you
ignore it. Rules are labelled **enforced** (a test or the start-up check fails when it breaks) or
**convention** (nothing fails; the guide and review are the control).

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
[deployment](../operations/deployment.md)) and set the variables per environment.

| Variable           | Meaning                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WEB_SEO_INDEXING` | `enabled` or `disabled`. Empty or unset means `disabled`. Any other value stops the web service at start-up.                                                              |
| `WEB_SITE_ORIGIN`  | The public origin, for example `https://shop.example.com`: no path, no trailing slash. Used for canonical links, hreflang, Open Graph URLs, the sitemap and `robots.txt`. |

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
2. **Place it outside the private groups.** Do not put it in `(auth)`, `(dashboard)`,
   `(organization-access)` or `admin`. The home page `/en` is the dashboard in this starter; a
   product with a public landing page restructures that route itself.
3. **Build its metadata with the helper.** Never write a `robots` key yourself.

   ```tsx
   // app/[locale]/(site)/pricing/page.tsx
   import type { Metadata } from 'next'
   import { getTranslations } from 'next-intl/server'

   import { resolveLocaleParam } from '@/i18n/params'
   import { buildPageMetadata } from '@/shared/lib/seo/page-metadata'

   export async function generateMetadata({
     params,
   }: {
     params: Promise<{ locale: string }>
   }): Promise<Metadata> {
     const locale = await resolveLocaleParam(params)
     const t = await getTranslations({ locale, namespace: 'pricing' })
     return buildPageMetadata({
       locale,
       path: '/pricing',
       title: t('title'),
       description: t('description'),
     })
   }
   ```

   `path` has no locale prefix and no query. The helper builds the absolute, locale-prefixed
   canonical URL, the language variants with `x-default`, Open Graph and Twitter data, and opens
   the page only when indexing is effective. Add the `pricing.*` message keys to every catalogue.

4. **List the page** in `src/_app/seo/public-pages.ts`, which ships returning an empty list:

   ```ts
   export async function getPublicPages() {
     return [{ path: '/pricing' }, { path: '', changeFrequency: 'weekly' as const }]
   }
   ```

   The function is `async`, so a product can read its pages from a database. The sitemap is built
   only from this list. **Convention:** a listed page must also use the helper. A listed page that
   forgot it stays `noindex` (safe) but appears in the sitemap, which Search Console reports as a
   warning. A page that uses the helper but is not listed is indexable and missing from the
   sitemap.

5. **Optional structured data.**

   ```tsx
   import { JsonLd } from '@/shared/lib/seo/json-ld'

   ;<JsonLd data={{ '@context': 'https://schema.org', '@type': 'Product', name: product.name }} />
   ```

   The component escapes every `<` so a value cannot close the script tag. Check the result with
   Google's Rich Results Test.

## Open production and keep everything else closed

1. On the production web service, set `WEB_SEO_INDEXING=enabled` and
   `WEB_SITE_ORIGIN=https://<your public host>`, and make sure `WEB_TRUSTED_ORIGINS` contains the
   same origin.
2. Leave both unset on every other environment.
3. Make the reverse proxy pass the public `Host` header unchanged (the bundled Caddy profile does).
   If a proxy rewrites it, the site stays closed (the safe direction); the verification block
   below shows it.
4. Verify with the block below, then register the site in Search Console and Yandex Webmaster.

## Verify

Replace `https://shop.example.com` with your origin. Run all of these against production and the
first two against staging.

```bash
# 1. Pages: no X-Robots-Tag on the site host when open; noindex on every other host.
curl -sI https://shop.example.com/en/pricing | grep -i x-robots-tag
curl -sI https://staging.example.com/en/pricing | grep -i x-robots-tag     # expect noindex, nofollow

# 2. A private page and the API stay closed.
curl -sI https://shop.example.com/en/login | grep -i x-robots-tag          # meta noindex in the page
curl -sI https://shop.example.com/api/auth/sessions | grep -i x-robots-tag # expect noindex, nofollow

# 3. Crawler files.
curl -s https://shop.example.com/robots.txt
curl -sI https://shop.example.com/sitemap.xml | head -1                    # 200, or 404 with no listed pages

# 4. Googlebot must receive the tags inside <head>, even when generateMetadata is slow.
curl -s -A 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' \
  https://shop.example.com/en/pricing |
  sed 's#</head>.*##' |
  grep -oE '<(link rel="(canonical|alternate)"|meta name="robots")[^>]*>'
```

The fourth command must print the `canonical` link, one `alternate` link per locale plus
`x-default`, and the `robots` meta tag. Repeat it with
`-A 'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)'`. To prove the slow case on
your own page, make its `generateMetadata` wait one second and run it again: a missing tag means
the tags were streamed into the page body, where Google does not accept them.

## Rules, reasons and consequences

| Rule                                                                                                                          | Why                                                                                                                                                                                                                                    | Check                                                                                  | If ignored                                                         | Status                                                       |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------ |
| Only `shared/lib/seo` writes a `robots` metadata key.                                                                         | Metadata merges shallowly: a page's `robots` object replaces the layout's whole object, so `'index, follow'`, `{ googleBot: { index: true } }` or `{ nocache: true }` reopen indexing without `index: true`.                           | `robots-key-guard.test.ts` scans all sources and proves itself on each forbidden form. | A page silently becomes indexable.                                 | Enforced                                                     |
| Close with `noindexMetadata`, open with `buildPageMetadata`.                                                                  | They return complete objects (`robots`, `openGraph`, `twitter`, `alternates`) so nothing is inherited by accident.                                                                                                                     | `page-metadata.test.ts`.                                                               | A page inherits the home page's canonical and is folded into it.   | Enforced                                                     |
| The proxy only adds `X-Robots-Tag`, never removes it.                                                                         | Next applies `next.config.ts` headers first and the proxy after; a static header must survive.                                                                                                                                         | `indexing.test.ts`.                                                                    | A closed surface could be reopened by the proxy.                   | Enforced                                                     |
| Indexing needs the exact site host. Only `Host` is read, never `X-Forwarded-Host`.                                            | The same image must stay closed on staging, aliases, raw IPs and the Console host.                                                                                                                                                     | `indexing.test.ts`.                                                                    | A client could open a closed host with a forged header.            | Enforced                                                     |
| `enabled` with a missing, non-`https` or untrusted origin stops start-up.                                                     | A misconfiguration the operator asked for must be loud, not a silently closed or wrongly open site.                                                                                                                                    | `site-origin.test.ts`.                                                                 | Wrong canonical URLs or an unexpectedly closed site.               | Enforced                                                     |
| `htmlLimitedBots` lists Googlebot.                                                                                            | For dynamic pages Next streams metadata into `<body>` unless the crawler is on this list; Google accepts `canonical` and hreflang only from `<head>`. Whether the tags reach `<head>` depends on how fast `generateMetadata` resolves. | `html-limited-bots.test.ts` requires Next's default list plus `                        | Googlebot`; verify step 4 above.                                   | Tags land in `<body>` on slow pages and Google ignores them. | Enforced (list), manual (behaviour) |
| hreflang comes from `buildPageMetadata` and the sitemap, not next-intl's `Link` header (`alternateLinks: false`).             | The header is built from the request's own `x-forwarded-host` on every response, including private pages and 404s.                                                                                                                     | `routing.ts`; verify step 4.                                                           | Wrong hosts in hreflang behind a proxy; hreflang on private pages. | Convention                                                   |
| `robots.txt` never lists private paths or the Console slug, and has no `Disallow`.                                            | A `Disallow` hides `noindex` from Google and Yandex, which must crawl a page to see it. Privacy comes from `noindex` plus authentication.                                                                                              | `crawler-files.test.ts`, `seo-headers.spec.ts`.                                        | Private URLs advertised; `noindex` never seen.                     | Enforced                                                     |
| `sitemap.xml` answers 404 when the site is closed or no pages are listed.                                                     | A closed product has no sitemap; an empty file only produces warnings.                                                                                                                                                                 | `seo-headers.spec.ts`.                                                                 | Search Console warnings.                                           | Enforced                                                     |
| A page that uses the helper is listed in `public-pages.ts`, and the reverse.                                                  | The sitemap is the one list of public URLs.                                                                                                                                                                                            | None: dynamic routes cannot be enumerated.                                             | Warning or a page missing from the sitemap.                        | Convention                                                   |
| Do not use `locale` or `params` in the root layout's `generateMetadata` beyond the existing `getTranslations({ locale, … })`. | The single-locale scaffold transform deletes both there.                                                                                                                                                                               | The scaffold transform fails or leaves an undeclared name.                             | A forked project that chose one locale does not build.             | Convention                                                   |

## Traps

- **Streamed metadata.** Fast metadata may reach `<head>`; slow metadata (a database read) goes to
  `<body>` for crawlers not on `htmlLimitedBots`. Test your own pages with the slow variant.
- **Merging.** A page that sets `openGraph`, `twitter`, `alternates` or `robots` replaces the
  layout's whole object. The root sets neither `alternates.canonical` nor `openGraph.url`, so a
  page that forgets them cannot inherit the home page's.
- **Forms that reopen indexing without `index: true`:** the string `'index, follow'`, a `googleBot`
  override, a partial object such as `{ nocache: true }`, a spread of a variable, `other.robots`.
  The guard test rejects the `robots` key itself.
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

## Search Console and Yandex Webmaster

- Verify ownership with a DNS TXT record. It needs no code and no per-environment token.
- Google reads hreflang from page `<head>` links, an HTTP header or the sitemap. Yandex reads it
  only from `<link rel="alternate" hreflang>` in `<head>`; this is why the helper publishes it
  there and `htmlLimitedBots` matters.
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
