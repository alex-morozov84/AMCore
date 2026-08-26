// Exact-text block primitives (ADR-071, PR3B) — a sibling of actions.mjs's
// field-level transforms, split out to stay under the repo's
// ~150-line-per-file guidance. "Exact text," not a regex heuristic: every
// function here fails closed unless what it's looking for appears exactly
// once, so a drifted source file aborts the transform instead of silently
// matching the wrong thing (or nothing).
import { EngineError } from './actions.mjs'

/**
 * Removes `block` from `content`, but only if it appears exactly once —
 * fails closed otherwise. For deleting a known multi-line chunk (an ESLint
 * config block, an obsolete exemption) by exact text rather than a regex
 * heuristic that could match more or less than intended.
 */
export function removeExactBlock(content, block) {
  return replaceExactBlock(content, block, '')
}

/** Like {@link removeExactBlock}, but replaces the one occurrence with `after` instead of removing it. */
export function replaceExactBlock(content, before, after) {
  const occurrences = content.split(before).length - 1
  if (occurrences !== 1) {
    throw new EngineError(
      `expected exactly one occurrence of the block to replace, found ${occurrences}`
    )
  }
  return content.replace(before, after)
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
