// Rewrites host-mode references to the non-localized console route shape.
import path from 'node:path'
import { fileStep, replaceAllExactText, replaceExactBlock } from './init-engine.mjs'
import {
  CADDY_STATIC_ASSETS,
  NGINX_STATIC_ASSETS,
} from './project-plan-admin-console-single-locale-proxy-assets.mjs'

const MULTI_TRAILING = `    location ~ ^(/(?:en|ru)(?:/.*[^/])?)/$ {
        return 308 $scheme://$host$1$is_args$args;
    }

`
const SINGLE_TRAILING = `    location ~ ^(/.+)/$ {
        return 308 $scheme://$host$1$is_args$args;
    }

`
const MULTI_CADDY_TRAILING = `\t@consoleTrailingSlash path_regexp consoleTrailingSlash ^(/(?:en|ru)(?:/.*[^/])?)/$
\thandle @consoleTrailingSlash {
\t\tredir {re.consoleTrailingSlash.1}?{query} 308
\t}

`
const SINGLE_CADDY_TRAILING = `\t@consoleTrailingSlash path_regexp consoleTrailingSlash ^(/.+)/$
\thandle @consoleTrailingSlash {
\t\tredir {re.consoleTrailingSlash.1}?{query} 308
\t}

`

function nginxPageBlock(slug) {
  return `    location ^~ /_next/ {
        proxy_pass http://web:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location = /favicon.ico { proxy_pass http://web:3000; }
    location = /manifest.webmanifest { proxy_pass http://web:3000; }

${NGINX_STATIC_ASSETS}    location = / {
        rewrite ^ /${slug} break;
        proxy_pass http://web:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        rewrite ^/(.*)$ /${slug}/$1 break;
        proxy_pass http://web:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
`
}

function caddyPageBlock(slug) {
  return `\t@nextAssets path /_next/*
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

${CADDY_STATIC_ASSETS}\t@consoleRoot path /
\thandle @consoleRoot {
\t\trewrite * /${slug}
\t\treverse_proxy web:3000 {
\t\t\theader_up Host {host}
\t\t}
\t}

\thandle {
\t\trewrite * /${slug}{path}
\t\treverse_proxy web:3000 {
\t\t\theader_up Host {host}
\t\t}
\t}
`
}

function rewriteNginxForSingleLocale(content, slug) {
  const withSlug = replaceAllExactText(content, '/admin', `/${slug}`)
  const multiPage = `    location ~ ^/(en|ru)(/.*)?$ {
        rewrite ^/(en|ru)(/.*)?$ /$1/${slug}$2 break;
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
  return replaceExactBlock(
    replaceExactBlock(withSlug, MULTI_TRAILING, SINGLE_TRAILING),
    multiPage,
    nginxPageBlock(slug)
  )
}

function rewriteCaddyForSingleLocale(content, slug) {
  const withSlug = replaceAllExactText(content, '/admin', `/${slug}`)
  const multiPage = `\t@consolePage path_regexp consolePage ^/(en|ru)(/.*)?$
\thandle @consolePage {
\t\trewrite * /{re.consolePage.1}/${slug}{re.consolePage.2}
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
  return replaceExactBlock(
    replaceExactBlock(withSlug, MULTI_CADDY_TRAILING, SINGLE_CADDY_TRAILING),
    multiPage,
    caddyPageBlock(slug)
  )
}

export function buildAdminConsoleSingleLocaleProxySteps(root, slug) {
  return [
    fileStep(
      path.join(root, 'docker/nginx/operations-console.conf'),
      (content) => rewriteNginxForSingleLocale(content, slug),
      'rewrite nginx console host routing for a single locale'
    ),
    fileStep(
      path.join(root, 'docker/caddy/Caddyfile.console-host'),
      (content) => rewriteCaddyForSingleLocale(content, slug),
      'rewrite Caddy console host routing for a single locale'
    ),
  ]
}
