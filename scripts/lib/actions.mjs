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
  const globalRegex = new RegExp(
    regex.source,
    regex.flags.includes('g') ? regex.flags : `${regex.flags}g`
  )
  const matches = [...content.matchAll(globalRegex)]
  if (matches.length !== 1) {
    throw new EngineError(`expected exactly one match for ${regex}, found ${matches.length}`)
  }
  const match = matches[0]
  const captured = match[1]
  const start = match.index + match[0].indexOf(captured)
  return content.slice(0, start) + newValue + content.slice(start + captured.length)
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

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Reads width/height straight from a PNG's IHDR chunk — no image-decoding dependency needed. */
export function readPngDimensions(buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new EngineError('not a valid PNG file (bad signature)')
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}
