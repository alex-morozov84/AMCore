// Pure, dependency-free content transforms used by the init tooling (Track
// 10, ADR-071). No fs access here — plan-steps.mjs wraps these around reads/
// writes so the transforms themselves stay trivially unit-testable.

export class EngineError extends Error {}

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Replaces the single capture group of `regex` inside `content` with
 * `newValue`, keeping everything else on the matched line intact. Fails
 * closed (throws) unless `regex` matches exactly once — this is what makes
 * every edit safe to compute ahead of time and safe to re-run.
 */
export function replaceCapturedField(content, regex, newValue) {
  // `d` (hasIndices) gives the capture group's own [start, end] span. Do not
  // locate it by searching the matched text for the captured substring —
  // if the current value's text also appears earlier in the match (e.g. a
  // field whose label and value happen to share a word), that finds the
  // wrong occurrence and corrupts the line instead of the value.
  let flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`
  flags = flags.includes('d') ? flags : `${flags}d`
  const globalRegex = new RegExp(regex.source, flags)
  const matches = [...content.matchAll(globalRegex)]
  if (matches.length !== 1) {
    throw new EngineError(`expected exactly one match for ${regex}, found ${matches.length}`)
  }
  const [start, end] = matches[0].indices[1]
  return content.slice(0, start) + newValue + content.slice(end)
}

const markdownFieldRegex = (label) =>
  new RegExp(`^- \\*\\*${escapeRegExp(label)}:\\*\\* (.*)$`, 'gm')

/** Reads a `- **Label:** value` bullet's current value, or undefined if absent. */
export function readMarkdownField(content, label) {
  const match = content.match(markdownFieldRegex(label))
  if (!match) return undefined
  return match[0].replace(markdownFieldRegex(label), '$1')
}

/**
 * Sets a `- **Label:** value` bullet. Replaces it if present; otherwise
 * inserts a new bullet right after `insertAfterLabel`'s line. Fails closed
 * if the field is duplicated, or if an insert is needed but the anchor
 * can't be found.
 */
export function setMarkdownField(content, { label, value, insertAfterLabel }) {
  if (/[\r\n]/.test(value)) {
    throw new EngineError(`field "${label}": value cannot contain a newline (one field per line)`)
  }
  const fieldRe = markdownFieldRegex(label)
  if (fieldRe.test(content)) {
    return replaceCapturedField(content, markdownFieldRegex(label), value)
  }
  if (!insertAfterLabel) {
    throw new EngineError(`field "${label}" not found and no insertAfterLabel given`)
  }
  const anchorRe = new RegExp(`^- \\*\\*${escapeRegExp(insertAfterLabel)}:\\*\\*.*$`, 'm')
  const anchorMatch = content.match(anchorRe)
  if (!anchorMatch) {
    throw new EngineError(`cannot insert "${label}": anchor "${insertAfterLabel}" not found`)
  }
  const insertAt = anchorMatch.index + anchorMatch[0].length
  return `${content.slice(0, insertAt)}\n- **${label}:** ${value}${content.slice(insertAt)}`
}

/**
 * Keeps only `locale`'s block inside a flat, one-level-deep
 * `{ <locale>: { ... }, <locale>: { ... } }` object literal whose blocks
 * don't themselves contain `{`/`}` (true for every locale-keyed message map
 * in this codebase today). Used to trim a `Record<SupportedLocale, ...>`
 * literal to one entry for `init:project --mode=single` — a regex can't
 * express "reserved," but it can express "one block per known locale key."
 * Fails closed if `locale`'s block isn't found.
 */
export function trimLocaleRecordLiteral(content, locale) {
  const blockRe = /^( {2})(\w+): \{\n([\s\S]*?)\n\1\},?\n/gm
  const blocks = [...content.matchAll(blockRe)]
  const kept = blocks.find((block) => block[2] === locale)
  if (!kept) {
    throw new EngineError(`no "${locale}" block found to keep in this locale-keyed object literal`)
  }
  const start = blocks[0].index
  const end = blocks.at(-1).index + blocks.at(-1)[0].length
  const keptBlock = `${kept[1]}${kept[2]}: {\n${kept[3]}\n${kept[1]}},\n`
  return content.slice(0, start) + keptBlock + content.slice(end)
}

/** Sets a dotted path (`meta.title`) on a plain object, creating intermediate objects as needed. */
export function setJsonPath(obj, dottedPath, value) {
  const keys = dottedPath.split('.')
  let cursor = obj
  for (let i = 0; i < keys.length - 1; i += 1) {
    if (typeof cursor[keys[i]] !== 'object' || cursor[keys[i]] === null) cursor[keys[i]] = {}
    cursor = cursor[keys[i]]
  }
  cursor[keys.at(-1)] = value
}

/** Reads the single capture group of the first match of `regex` in `content`, or undefined. */
export function readCapturedField(content, regex) {
  const match = content.match(regex)
  return match ? match[1] : undefined
}

/**
 * Escapes `value` for insertion as the *inner content* of an existing
 * single-quoted TS/JS string literal (the surrounding quotes are already
 * in the file and stay put). Rejects newlines — these fields are always
 * meant to be single-line, and a literal newline would either break the
 * statement or silently span multiple lines.
 */
export function escapeTsSingleQuoteInner(value) {
  if (/[\r\n]/.test(value)) {
    throw new EngineError('value cannot contain a newline inside a single-line TS string literal')
  }
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Reads width/height straight from a PNG's IHDR chunk — no image-decoding dependency needed. */
export function readPngDimensions(buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new EngineError('not a valid PNG file (bad signature)')
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}
