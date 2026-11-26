import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseCiPolicy } from './ci-policy.mjs'
import { planConsoleEdgeFiles } from './console-edge.mjs'
import { planProductAdminEdgeFiles } from './product-admin-edge.mjs'
import {
  readAdminConsoleSettings,
  readLocaleSettings,
  validateLocaleSettings,
} from './settings-files.mjs'

const localesFile = 'packages/shared/src/config/locales.json'
const consoleFile = 'packages/shared/src/config/admin-console.json'
const ciFile = 'ci/product.json'
const progressFile = 'apps/web/src/shared/lib/route-progress/route-progress-flag.ts'
const themeFile = 'apps/web/src/shared/lib/theme-availability.ts'
export const PRODUCT_SETTINGS_PATHS = [
  localesFile,
  consoleFile,
  ciFile,
  progressFile,
  themeFile,
  'docker/caddy/Caddyfile.console-host',
  'docker/nginx/operations-console.conf',
  'docker/caddy/product-admin.generated.caddy',
  'docker/nginx/product-admin.generated.conf',
  'docker/nginx/product-admin-site.generated.conf',
]

function setInitializer(before, line, value) {
  const matches = [...before.matchAll(line)]
  if (matches.length !== 1) throw new Error('Expected one matching setting declaration')
  return before.replace(line, (_, prefix) => prefix + value)
}

export function proposedLocales(root, answers) {
  const current = readLocaleSettings(root)
  const enabled = answers.locales?.split(',') ?? current.enabled
  const next = {
    ...current,
    enabled,
    default:
      answers.defaultLocale ?? (enabled.includes(current.default) ? current.default : enabled[0]),
  }
  const problems = validateLocaleSettings(next)
  if (problems.length) throw new Error(`Invalid site languages: ${problems.join(', ')}`)
  return next
}

export function materializeProductSettings(root, answers) {
  const steps = []
  function edit(file, transform) {
    const target = join(root, file)
    const before = readFileSync(target, 'utf8')
    const after = transform(before)
    if (before !== after) steps.push({ kind: 'edit', target, before, after, summary: 'settings' })
  }
  const json = (value) => JSON.stringify(value, null, 2) + '\n'
  const { routeProgress, themeAvailability, ciMode, consoleMode } = answers
  if (routeProgress !== undefined)
    edit(progressFile, (text) =>
      setInitializer(
        text,
        /^(export const ROUTE_PROGRESS_ENABLED = )(?:true|false)$/gm,
        String(routeProgress === 'on')
      )
    )
  if (themeAvailability !== undefined)
    edit(themeFile, (text) =>
      setInitializer(
        text,
        /^(export const THEME_AVAILABILITY: ThemeAvailability = )'(?:both|light|dark)'$/gm,
        `'${themeAvailability}'`
      )
    )
  if (ciMode !== undefined)
    edit(ciFile, () => json(parseCiPolicy(json({ version: 1, mode: ciMode }))))
  if (
    answers.locales === undefined &&
    answers.defaultLocale === undefined &&
    consoleMode === undefined
  )
    return steps

  const locales = proposedLocales(root, answers)
  const console = readAdminConsoleSettings(root)
  if (consoleMode && console.mode === 'host')
    throw new Error('Use the placement guide to move a Console host')
  const mode = consoleMode ?? console.mode
  const edge = planProductAdminEdgeFiles(root, { locales })
  if (JSON.stringify(locales) !== JSON.stringify(readLocaleSettings(root)))
    edit(localesFile, () => json(locales))
  if (mode !== console.mode) edit(consoleFile, () => json({ ...console, mode }))
  for (const [file, content] of planConsoleEdgeFiles(root, {
    alias: console.alias,
    mode,
    locales: locales.enabled,
  }))
    edit(file, () => content)
  for (const [file, content] of edge) edit(file, () => content)
  return steps
}
