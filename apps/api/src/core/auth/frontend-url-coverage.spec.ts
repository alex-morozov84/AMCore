import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Guard: every user-facing link the backend builds must carry a locale.
 *
 * `apps/web` prefixes every locale (`/en/...`, `/ru/...`). A server-generated
 * link to a bare path is resolved by cookie or `Accept-Language` — which an
 * emailed link cannot rely on (the recipient may open it in a browser that has
 * never visited the app) and an OAuth callback cannot either (mid-sign-in, no
 * locale cookie yet). A Russian user then lands on an English page.
 *
 * That defect shipped once and was caught by review, not by a test. This guard
 * exists so the next backend module cannot reintroduce it.
 *
 * **Checked per occurrence, not per file.** A file-level check ("does this file
 * mention the helper somewhere?") would pass a bare URL added next to a correct
 * one — and the files most likely to grow a new link are exactly the ones that
 * already contain three correct ones.
 *
 * The rule is therefore mechanical: **every read of `FRONTEND_URL` must sit
 * inside a `localizedFrontendUrl(...)` argument list.** Assigning it to a
 * variable first is not allowed, because that breaks the check with no
 * compensating benefit.
 *
 * @see docs/frontend/i18n-and-errors.md → "Links the backend sends"
 */

const SRC_ROOT = join(__dirname, '..', '..')
const NEEDLE = 'FRONTEND_URL'
const HELPER = 'localizedFrontendUrl('

/**
 * Files allowed to read `FRONTEND_URL` outside the helper. Keep this short and
 * justified — each entry is a place the guard is deliberately blind.
 */
const ALLOWLIST: Record<string, string> = {
  'env/schema/email.env.ts': 'declares the variable itself',
}

/** Blank out comments so prose mentioning the variable is not a false positive. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => ' '.repeat(match.length))
    .replace(/\/\/[^\n]*/g, (match) => ' '.repeat(match.length))
}

/**
 * True when `index` falls inside the argument list of a `localizedFrontendUrl(`
 * call. Walks forward from the nearest preceding call, tracking paren depth, so
 * a later sibling call cannot vouch for an earlier bare usage.
 */
function isInsideHelperCall(source: string, index: number): boolean {
  const callStart = source.lastIndexOf(HELPER, index)
  if (callStart === -1) return false

  let depth = 0
  for (let i = callStart + HELPER.length - 1; i < source.length; i++) {
    const char = source[i]
    if (char === '(') depth++
    else if (char === ')') {
      depth--
      if (depth === 0) return index < i
    }
  }
  return false
}

function collectSourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'generated') continue // Prisma output
      collectSourceFiles(full, found)
      continue
    }
    // `.tsx` matters: React Email templates live there, right next to the
    // user-facing links this guard protects.
    if (!/\.tsx?$/.test(entry) || /\.spec\.tsx?$/.test(entry)) continue
    found.push(full)
  }
  return found
}

describe('frontend URL locale coverage', () => {
  const offenders: string[] = []
  const referencingFiles: string[] = []
  let occurrences = 0

  for (const file of collectSourceFiles(SRC_ROOT)) {
    const source = stripComments(readFileSync(file, 'utf8'))
    if (!source.includes(NEEDLE)) continue

    const key = relative(SRC_ROOT, file).split('\\').join('/')
    referencingFiles.push(key)
    if (key in ALLOWLIST) continue

    for (
      let index = source.indexOf(NEEDLE);
      index !== -1;
      index = source.indexOf(NEEDLE, index + 1)
    ) {
      occurrences++
      if (!isInsideHelperCall(source, index)) {
        const line = source.slice(0, index).split('\n').length
        offenders.push(`${key}:${line}`)
      }
    }
  }

  it('wraps every FRONTEND_URL read in localizedFrontendUrl()', () => {
    expect(offenders).toEqual([])
  })

  it('finds the FRONTEND_URL reads at all', () => {
    // Guards the guard: a renamed variable or a broken path would otherwise let
    // the check above pass vacuously over an empty set.
    expect(occurrences).toBeGreaterThanOrEqual(5)
    expect(referencingFiles.length).toBeGreaterThanOrEqual(3)
  })

  it('keeps the allowlist honest', () => {
    // An allowlisted file that no longer reads FRONTEND_URL is stale — the
    // exemption should be removed rather than left to cover something new.
    const stale = Object.keys(ALLOWLIST).filter((key) => !referencingFiles.includes(key))
    expect(stale).toEqual([])
  })
})
