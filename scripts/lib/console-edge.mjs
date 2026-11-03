import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { readAdminConsoleSettings, readLocaleSettings } from './settings-files.mjs'

// Console host-mode edge blocks (Caddy and nginx) generated from the two settings files:
// `admin-console.json` (alias) and `locales.json` (served locales). With several locales the
// public path starts with the locale; with one it does not, and the edge maps a public page onto
// the physical `/<alias>` folder (the web app then adds the locale itself). Regenerate with
// `node scripts/render-console-edge.mjs --write`; CI runs `--check`.

const START = '# AMCORE_ADMIN_CONSOLE_PROXY_START'
const END = '# AMCORE_ADMIN_CONSOLE_PROXY_END'
const NGINX_START = '    # AMCORE_ADMIN_CONSOLE_LOCATIONS_START'
const NGINX_END = '    # AMCORE_ADMIN_CONSOLE_LOCATIONS_END'

// Both files are validated with the same rules as the shared schemas before anything is
// generated, so a wrong file stops here and never reaches the proxy files.
export function readConsoleEdgeSettings(root) {
  const locales = readLocaleSettings(root).enabled
  const { alias, mode } = readAdminConsoleSettings(root)
  return { alias, mode, locales }
}

const caddyProxy = (indent) =>
  `${indent}reverse_proxy web:3000 {\n${indent}\theader_up Host {hostport}\n${indent}}`

function caddyPages({ alias, locales }) {
  if (locales.length > 1) {
    const languages = locales.join('|')
    return {
      trailing: `	@consoleTrailingSlash path_regexp consoleTrailingSlash ^(/(?:${languages})(?:/.*[^/])?)/$
	handle @consoleTrailingSlash {
		redir {re.consoleTrailingSlash.1}?{query} 308
	}
`,
      pages: `	@consolePage path_regexp consolePage ^/(${languages})(/.*)?$
	handle @consolePage {
		rewrite * /{re.consolePage.1}/${alias}{re.consolePage.2}
${caddyProxy('\t\t')}
	}
`,
    }
  }
  return {
    trailing: '',
    // Not limited to a locale prefix, so it must run after the /api/ handles (the queue board's
    // root, /api/bull-board/, ends with a slash).
    pages: `	@consoleTrailingSlash path_regexp consoleTrailingSlash ^(/.*[^/])/$
	handle @consoleTrailingSlash {
		redir {re.consoleTrailingSlash.1}?{query} 308
	}

	@consoleNextAssets path /_next/*
	handle @consoleNextAssets {
${caddyProxy('\t\t')}
	}

	@consoleRoot path /
	handle @consoleRoot {
		rewrite * /${alias}
${caddyProxy('\t\t')}
	}

	@consolePage path_regexp consolePage ^(/[^.]*)$
	handle @consolePage {
		rewrite * /${alias}{re.consolePage.1}
${caddyProxy('\t\t')}
	}
`,
  }
}

export function renderConsoleCaddy(settings) {
  const { alias } = settings
  const { trailing, pages } = caddyPages(settings)
  const proxy = caddyProxy('\t\t')
  return `{$ADMIN_CONSOLE_HOSTNAME} {
	@physicalConsolePath path /${alias} /${alias}/*
	handle @physicalConsolePath {
		respond 404
	}

${trailing ? `${trailing}\n` : ''}	@cspReport path /api/csp-report
	handle @cspReport {
${proxy}
	}

	@deploymentVersion path /api/deployment-version
	handle @deploymentVersion {
${proxy}
	}

	# The queue board's root has a trailing slash (its page base). Next.js would redirect it to the
	# slashless address and that redirect names the physical /api/console/ path, so the root is
	# mapped to the slashless physical route here, query preserved.
	@consoleBoardRoot path /api/bull-board/
	handle @consoleBoardRoot {
		rewrite * /api/console/bull-board
${proxy}
	}

	@consoleApi path /api/*
	handle @consoleApi {
		# Only the FIRST /api/: the queue board's own data paths (/api/bull-board/api/queues) contain a
		# second one, and Caddy replaces every occurrence unless it is given a limit.
		uri replace /api/ /api/console/ 1
${proxy}
	}

${pages}
	handle {
${proxy}
	}
}
`
}

// `$http_host` keeps the port the client used. The web app compares the whole Host authority
// (host and port) with its configured origin, as Caddy's `{hostport}` does; `$host` would drop
// a non-default port and the Console would look like the wrong host.
const nginxProxy = `        proxy_pass http://web:3000;
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-Proto $scheme;`

export function renderConsoleNginxLocations(settings) {
  const { alias, locales } = settings
  const multi = locales.length > 1
  const languages = locales.join('|')
  const trailing = multi ? String.raw`^(/(?:${languages})(?:/.*[^/])?)/$` : String.raw`^(/.*[^/])/$`
  const pages = multi
    ? `    location ~ ^/(${languages})(/.*)?$ {
        rewrite ^/(${languages})(/.*)?$ /$1/${alias}$2 break;
${nginxProxy}
    }
`
    : `    location ^~ /_next/ {
${nginxProxy}
    }

    location = / {
        rewrite ^ /${alias} break;
${nginxProxy}
    }

    location ~ ^/[^.]*$ {
        rewrite ^(.*)$ /${alias}$1 break;
${nginxProxy}
    }
`
  return `    location = /${alias} {
        return 404;
    }

    location ^~ /${alias}/ {
        return 404;
    }

    location ~ ${trailing} {
        return 308 $scheme://$http_host$1$is_args$args;
    }

    location = /api/csp-report {
${nginxProxy}
    }

    location = /api/deployment-version {
${nginxProxy}
    }

    # The queue board's root has a trailing slash (its page base). Next.js would redirect it to the
    # slashless address and that redirect names the physical /api/console/ path, so the root is
    # mapped to the slashless physical route here (the query string is kept).
    # Both spellings are exact locations: with only the slash form defined, nginx itself answers the
    # slashless address with a redirect.
    location = /api/bull-board/ {
        rewrite ^ /api/console/bull-board break;
${nginxProxy}
    }

    location = /api/bull-board {
        rewrite ^ /api/console/bull-board break;
${nginxProxy}
    }

    location ^~ /api/ {
        rewrite ^/api/(.*)$ /api/console/$1 break;
${nginxProxy}
    }

${pages}
    location / {
${nginxProxy}
    }
`
}

function replaceBetween(text, startMarker, endMarker, body, file) {
  const start = text.indexOf(startMarker)
  const end = text.indexOf(endMarker)
  if (start < 0 || end < start) throw new Error(`Missing Console edge markers in ${file}`)
  const from = text.indexOf('\n', start) + 1
  return `${text.slice(0, from)}${body}${text.slice(end)}`
}

const CADDY_FILE = 'docker/caddy/Caddyfile.console-host'
const NGINX_FILE = 'docker/nginx/operations-console.conf'

/** The seam keeps its two-line comment; the generated block sits between it and the end marker. */
function caddyWithBlock(text, block) {
  const start = text.indexOf(START)
  const afterComment = text.indexOf('\n', text.indexOf('\n', start) + 1) + 1
  const end = text.indexOf(END)
  if (start < 0 || end < start) throw new Error(`Missing Console edge markers in ${CADDY_FILE}`)
  return `${text.slice(0, afterComment)}${block}${text.slice(end)}`
}

export function consoleEdgeFiles(root, write = false) {
  const settings = readConsoleEdgeSettings(root)
  const wanted = new Map()
  const caddy = readFileSync(join(root, CADDY_FILE), 'utf8')
  wanted.set(CADDY_FILE, caddyWithBlock(caddy, renderConsoleCaddy(settings)))
  const nginx = readFileSync(join(root, NGINX_FILE), 'utf8')
  wanted.set(
    NGINX_FILE,
    replaceBetween(nginx, NGINX_START, NGINX_END, renderConsoleNginxLocations(settings), NGINX_FILE)
  )
  const stale = []
  for (const [file, content] of wanted) {
    const current = readFileSync(join(root, file), 'utf8')
    if (current === content) continue
    if (write) writeFileSync(join(root, file), content)
    else stale.push(file)
  }
  if (stale.length)
    throw new Error(
      `Console edge files are stale: ${stale.join(', ')}. Run: node scripts/render-console-edge.mjs --write`
    )
  return wanted
}
