import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { inspectProductAdminPlacement } from './product-admin-placement.mjs'

const outputs = {
  caddy: 'docker/caddy/product-admin.generated.caddy',
  nginx: 'docker/nginx/product-admin.generated.conf',
  nginxSite: 'docker/nginx/product-admin-site.generated.conf',
}

function publicRoutePattern(routes) {
  const paths = routes.map((segments) =>
    segments
      .map((segment) => {
        if (/^\[\[\.\.\..+\]\]$/.test(segment)) return '(?:/[^/]+(?:/[^/]+)*)?'
        if (/^\[\.\.\..+\]$/.test(segment)) return '/[^/]+(?:/[^/]+)*'
        if (/^\[.+\]$/.test(segment)) return '/[^/]+'
        return '/' + segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      })
      .join('')
  )
  return `(?:${[...new Set(paths)].join('|')})`
}

/** Snippets belong inside the separate administration host, never the site's host. */
export function renderProductAdminEdge(root) {
  const { alias, mode, localized, locales, assets, defaultLocale, routes } =
    inspectProductAdminPlacement(root)
  const heading =
    '# Generated from product-admin placement. Regenerate with scripts/render-product-admin-edge.mjs.\n'
  if (mode === 'path')
    return {
      caddy: `${heading}# Path mode: no separate administration host.\n`,
      nginx: `${heading}# Path mode: no separate administration host.\n`,
      nginxSite: `${heading}# Path mode: no separate administration host.\n`,
    }
  const languages = locales.join('|')
  const physical = localized
    ? `^/(?:${languages})/${alias}(?:/|$)|^/${alias}(?:/|$)`
    : `^/${alias}(?:/|$)`
  const suffixes = publicRoutePattern(routes)
  const publicPage = localized ? `^/(${languages})(${suffixes})$` : `^(${suffixes})$`
  const replacement = localized
    ? `/{re.adminPage.1}/${alias}{re.adminPage.2}`
    : `/${alias}{re.adminPage.1}`
  const nginxReplacement = localized ? `/$1/${alias}$2` : `/${alias}$1`
  const caddyProxy = `reverse_proxy web:3000 {\n  header_up Host {hostport}\n  header_up -X-Forwarded-Host\n  header_up X-Forwarded-Proto {scheme}\n  header_up -X-Amcore-Web-Frontend\n  header_up -X-Amcore-Web-Placement\n  header_up -X-Amcore-Web-Context-Key\n}`
  const entry = localized ? `/${defaultLocale}/organizations` : '/organizations'
  const siteAuth = [
    'login',
    'register',
    'logout',
    'forgot-password',
    'reset-password',
    'verify-email',
    'resend-verification',
    'oauth',
    'mfa',
  ]
  const siteAuthPattern = `^/api/auth/(?:${siteAuth.join('|')})(?:/|$)`
  const publicAssets = [
    ...assets,
    '/favicon.ico',
    '/manifest.webmanifest',
    '/robots.txt',
    '/sitemap.xml',
  ]
  const nginxAssets = publicAssets
    .map((path) => path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
  const caddy = `${heading}(product_admin_site) {
  route {
    @physicalOnSite path_regexp adminPhysicalSite ${physical}
    respond @physicalOnSite 404
    @staffAuthOnSite path /api/product-admin /api/product-admin/*
    respond @staffAuthOnSite 404
    ${caddyProxy}
  }
}
(product_admin_staff) {
  route {
    @physical path_regexp adminPhysical ${physical}
    respond @physical 404
    @controlPlane path /api/console /api/console/* ${siteAuth.flatMap((path) => [`/api/auth/${path}`, `/api/auth/${path}/*`]).join(' ')}
    respond @controlPlane 404
    @root path /
    redir @root ${entry} 308
    @transport path /api/* /_next/* ${publicAssets.map((path) => JSON.stringify(path)).join(' ')}
    handle @transport {
      ${caddyProxy}
    }
    @trailing path_regexp adminTrailing ^(.+[^/])/$
    redir @trailing {re.adminTrailing.1}?{query} 308
    @pages path_regexp adminPage ${publicPage}
    handle @pages {
      rewrite * ${replacement}
      ${caddyProxy}
    }
    respond 404
  }
}
`
  const nginxHeaders = `proxy_set_header Host $http_host;
proxy_set_header X-Forwarded-Host "";
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Amcore-Web-Frontend "";
proxy_set_header X-Amcore-Web-Placement "";
proxy_set_header X-Amcore-Web-Context-Key "";`
  const nginx = `${heading}# Include inside the dedicated TLS server block; web stays private.
${nginxHeaders}
location ~ "${physical}" { return 404; }
location ~ ^/api/console(?:/|$) { return 404; }
location ~ ${siteAuthPattern} { return 404; }
location = / { return 308 ${entry}; }
location ~ ^/(?:api|_next)/ { proxy_pass http://web:3000; }
location ~ "^(?:${nginxAssets})$" { proxy_pass http://web:3000; }
location ~ ^(.+[^/])/$ { return 308 $1$is_args$args; }
location ~ "${publicPage}" {
  rewrite "${publicPage}" ${nginxReplacement} break;
  proxy_pass http://web:3000;
}
location / { return 404; }
`
  return {
    caddy,
    nginx,
    nginxSite: `${heading}# Include inside the site's TLS server in host mode.
${nginxHeaders}
location ~ "${physical}" { return 404; }
location ~ ^/api/product-admin(?:/|$) { return 404; }
location / { proxy_pass http://web:3000; }
`,
  }
}

export function productAdminEdgeFiles(root, write = false) {
  const rendered = renderProductAdminEdge(root)
  for (const [kind, file] of Object.entries(outputs)) {
    if (write) writeFileSync(join(root, file), rendered[kind])
    else if (readFileSync(join(root, file), 'utf8') !== rendered[kind])
      throw new Error(`Stale product-admin edge output: ${file}`)
  }
}
