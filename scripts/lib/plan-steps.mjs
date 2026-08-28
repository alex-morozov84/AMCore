// Builds the typed "steps" a Plan is made of. Every step computes its full
// before/after diff at build time (nothing here writes) — that's what makes
// `--dry-run` exact and `apply()` a pure "replay the already-computed plan."
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  setMarkdownField,
  replaceCapturedField,
  setJsonPath,
  deleteJsonPath,
  EngineError,
} from './actions.mjs'

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

/**
 * A step that replaces a whole file's content, but only if it currently
 * matches `expectedBefore` exactly — fails closed otherwise, rather than
 * silently rewriting a file that has drifted from what the transform
 * assumed. Use for files whose structural rewrite (moving locale-resolution
 * boilerplate, rewriting an import) is too bespoke per file for a shared
 * regex to apply safely across several similar-but-not-identical files.
 */
export function exactContentStep(filePath, { expectedBefore, after }, summary) {
  const before = readFileSync(filePath, 'utf8')
  if (before !== expectedBefore) {
    throw new EngineError(
      `${filePath} does not match the content this transform expects — refusing to overwrite ` +
        '(the file may have drifted since this step was written)'
    )
  }
  return {
    kind: 'edit',
    target: filePath,
    summary: before === after ? `${summary} (already up to date)` : summary,
    changed: before !== after,
    before,
    after,
    write: () => writeFileSync(filePath, after, 'utf8'),
  }
}

/**
 * A step that both moves a file AND rewrites its content in one operation —
 * for files that need a structural edit as part of relocating (e.g. a page
 * that loses its locale-resolution boilerplate when it moves out from under
 * `[locale]/`). A plain `moveFileStep` followed by a separate
 * `exactContentStep(newPath, ...)` cannot express this: the plan is built by
 * reading the *current* disk state before any step runs, so the second step
 * would try to read a file at `newPath` that doesn't exist yet. Fails closed
 * exactly like `exactContentStep` if `oldPath`'s content has drifted.
 */
export function moveAndRewriteStep(oldPath, newPath, { expectedBefore, after }, summary) {
  const before = readFileSync(oldPath, 'utf8')
  if (before !== expectedBefore) {
    throw new EngineError(
      `${oldPath} does not match the content this transform expects — refusing to move/rewrite ` +
        '(the file may have drifted since this step was written)'
    )
  }
  return {
    kind: 'edit',
    target: newPath,
    summary,
    changed: true,
    before,
    after,
    write: () => {
      mkdirSync(dirname(newPath), { recursive: true })
      writeFileSync(newPath, after, 'utf8')
      if (oldPath !== newPath) rmSync(oldPath, { force: true })
    },
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

/** A step that moves a file (or directory) from `srcPath` to `destPath`, content unchanged. */
export function moveFileStep(srcPath, destPath, summary) {
  return {
    kind: 'move',
    target: destPath,
    summary,
    changed: true,
    write: () => {
      mkdirSync(dirname(destPath), { recursive: true })
      renameSync(srcPath, destPath)
    },
  }
}

/** A step that deletes a file or directory (recursively). */
export function deleteFileStep(targetPath, summary) {
  return {
    kind: 'delete',
    target: targetPath,
    summary,
    changed: true,
    write: () => rmSync(targetPath, { recursive: true, force: true }),
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

/** `content => content` parsing JSON, deleting dotted-path keys, and re-serializing at 2-space indent. */
export function jsonDeleteTransform(paths) {
  return (content) => {
    const obj = JSON.parse(content)
    for (const path of paths) deleteJsonPath(obj, path)
    return `${JSON.stringify(obj, null, 2)}\n`
  }
}
