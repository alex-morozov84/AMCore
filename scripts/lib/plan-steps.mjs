// Builds the typed "steps" a Plan is made of. Every step computes its full
// before/after diff at build time (nothing here writes) — that's what makes
// `--dry-run` exact and `apply()` a pure "replay the already-computed plan."
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { setMarkdownField, replaceCapturedField, setJsonPath } from './actions.mjs'

/** A step that rewrites one text file via a pure `content => content` transform. */
export function fileStep(filePath, transform, summary) {
  const before = readFileSync(filePath, 'utf8')
  const after = transform(before)
  const changed = before !== after
  return {
    kind: 'edit',
    target: filePath,
    summary: changed ? summary : `${summary} (already up to date)`,
    changed,
    before,
    after,
    write: () => writeFileSync(filePath, after, 'utf8'),
  }
}

/** A step that copies a binary file (logo/icon) into place. Always reported as a change. */
export function copyFileStep(srcPath, destPath, summary) {
  return {
    kind: 'copy',
    target: destPath,
    summary,
    changed: true,
    write: () => {
      mkdirSync(dirname(destPath), { recursive: true })
      copyFileSync(srcPath, destPath)
    },
  }
}

/** `content => content` applying a list of `{ label, value, insertAfterLabel }` markdown-field ops in order. */
export function markdownFieldsTransform(ops) {
  return (content) => ops.reduce((acc, op) => setMarkdownField(acc, op), content)
}

/** `content => content` applying a list of `{ regex, value }` single-capture-group line patches in order. */
export function linePatchesTransform(ops) {
  return (content) =>
    ops.reduce((acc, op) => replaceCapturedField(acc, op.regex, op.value), content)
}

/** `content => content` parsing JSON, setting dotted-path keys, and re-serializing at 2-space indent. */
export function jsonPatchTransform(patches) {
  return (content) => {
    const obj = JSON.parse(content)
    for (const [key, value] of Object.entries(patches)) setJsonPath(obj, key, value)
    return `${JSON.stringify(obj, null, 2)}\n`
  }
}
