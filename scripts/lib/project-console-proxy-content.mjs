import { replaceAllExactText, replaceExactBlock } from './content-blocks.mjs'

const NGINX_TRAILING = `    location ~ ^(/(?:en|ru)(?:/.*[^/])?)/$ {
        return 308 $scheme://$host$1$is_args$args;
    }

`
const CADDY_TRAILING = `\t@consoleTrailingSlash path_regexp consoleTrailingSlash ^(/(?:en|ru)(?:/.*[^/])?)/$
\thandle @consoleTrailingSlash {
\t\tredir {re.consoleTrailingSlash.1}?{query} 308
\t}

`
const NGINX_SINGLE_TRAILING = `    location ~ ^(/.+)/$ {
        return 308 $scheme://$host$1$is_args$args;
    }

`
const CADDY_SINGLE_TRAILING = `\t@consoleTrailingSlash path_regexp consoleTrailingSlash ^(/.+)/$
\thandle @consoleTrailingSlash {
\t\tredir {re.consoleTrailingSlash.1}?{query} 308
\t}

`
const NGINX_PAGE = `    location ~ ^/(en|ru)(/.*)?$ {
        rewrite ^/(en|ru)(/.*)?$ /$1/admin$2 break;
        proxy_pass http://web:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://web:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
`
const CADDY_PAGE = `\t@consolePage path_regexp consolePage ^/(en|ru)(/.*)?$
\thandle @consolePage {
\t\trewrite * /{re.consolePage.1}/admin{re.consolePage.2}
\t\treverse_proxy web:3000 {
\t\t\theader_up Host {host}
\t\t}
\t}

\thandle {
\t\treverse_proxy web:3000 {
\t\t\theader_up Host {host}
\t\t}
\t}
`
const NGINX_SINGLE_PAGE = `    location ^~ /_next/ {
        proxy_pass http://web:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location = /favicon.ico { proxy_pass http://web:3000; }
    location = /manifest.webmanifest { proxy_pass http://web:3000; }

    location ~* "\\.[a-z0-9]{1,16}$" {
        proxy_pass http://web:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location = / {
        rewrite ^ /__SLUG__ break;
        proxy_pass http://web:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        rewrite ^/(.*)$ /__SLUG__/$1 break;
        proxy_pass http://web:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
`
const CADDY_SINGLE_PAGE = `\t@nextAssets path /_next/*
\thandle @nextAssets {
\t\treverse_proxy web:3000 {
\t\t\theader_up Host {host}
\t\t}
\t}

\t@metadata path /favicon.ico /manifest.webmanifest
\thandle @metadata {
\t\treverse_proxy web:3000 {
\t\t\theader_up Host {host}
\t\t}
\t}

\t@staticAsset path_regexp staticAsset ^/.*\\.[a-zA-Z0-9]{1,16}$
\thandle @staticAsset {
\t\treverse_proxy web:3000 {
\t\t\theader_up Host {host}
\t\t}
\t}

\t@consoleRoot path /
\thandle @consoleRoot {
\t\trewrite * /__SLUG__
\t\treverse_proxy web:3000 {
\t\t\theader_up Host {host}
\t\t}
\t}

\thandle {
\t\trewrite * /__SLUG__{path}
\t\treverse_proxy web:3000 {
\t\t\theader_up Host {host}
\t\t}
\t}
`
const nginxPage = (slug) => NGINX_SINGLE_PAGE.replaceAll('__SLUG__', slug)
const caddyPage = (slug) => CADDY_SINGLE_PAGE.replaceAll('__SLUG__', slug)
function slugOnly(text, { slug }) {
  return replaceAllExactText(text, '/admin', `/${slug}`)
}
function singleLocale(text, { slug, proxy }) {
  const withSlug = slugOnly(text, { slug })
  if (proxy === 'nginx') {
    return replaceExactBlock(
      replaceExactBlock(withSlug, NGINX_TRAILING, NGINX_SINGLE_TRAILING),
      NGINX_PAGE.replaceAll('/admin', `/${slug}`),
      nginxPage(slug)
    )
  }
  return replaceExactBlock(
    replaceExactBlock(withSlug, CADDY_TRAILING, CADDY_SINGLE_TRAILING),
    CADDY_PAGE.replaceAll('/admin', `/${slug}`),
    caddyPage(slug)
  )
}
const claims = ({ slug, proxy }) => [
  { location: `${proxy}:console-route-shape`, value: 'single-locale' },
  { location: `${proxy}:console-slug`, value: slug },
]
export function projectConsoleProxyDefinition(key) {
  if (key === 'console.proxy-slug') {
    return {
      claims: ({ slug, proxy }) => [{ location: `${proxy}:console-slug`, value: slug }],
      apply: slugOnly,
    }
  }
  return key === 'console.proxy-single-locale' ? { claims, apply: singleLocale } : undefined
}
