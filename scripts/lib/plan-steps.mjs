// Typed scaffold plan steps: compute before/after up front, then replay exactly.
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  setMarkdownField,
  replaceCapturedField,
  setJsonPath,
  deleteJsonPath,
  EngineError,
} from './actions.mjs'

function measurementModule() {
  if (process.env.AMCORE_MEASURE_OPERATIONS !== '1') return undefined
  const match = new Error().stack?.match(/\/scripts\/lib\/(project-plan-[^():]+\.mjs):\d+:\d+/)
  return match ? `scripts/lib/${match[1]}` : null
}

/** A step that rewrites one text file via a pure `content => content` transform. */
export function fileStep(filePath, transform, summary) {
  const before = readFileSync(filePath, 'utf8')
  const after = transform(before)
  const changed = before !== after
  return {
    kind: 'edit',
    adapterClass: transform.adapterClass ?? 'custom-edit-unclassified',
    modulePath: measurementModule(),
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
    adapterClass: 'whole-file-legacy-before-after',
    modulePath: measurementModule(),
    target: filePath,
    summary: before === after ? `${summary} (already up to date)` : summary,
    changed: before !== after,
    before,
    after,
    write: () => writeFileSync(filePath, after, 'utf8'),
  }
}

/** Moves and rewrites atomically; separate steps cannot read a just-created target during plan build. */
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
    adapterClass: 'move-and-rewrite',
    modulePath: measurementModule(),
    source: oldPath,
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
    adapterClass: 'copy',
    modulePath: measurementModule(),
    source: srcPath,
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
    adapterClass: 'move',
    modulePath: measurementModule(),
    source: srcPath,
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
    adapterClass: 'delete',
    modulePath: measurementModule(),
    target: targetPath,
    summary,
    changed: true,
    write: () => rmSync(targetPath, { recursive: true, force: true }),
  }
}

/** `content => content` applying a list of `{ label, value, insertAfterLabel }` markdown-field ops in order. */
function taggedTransform(adapterClass, transform) {
  transform.adapterClass = adapterClass
  return transform
}

export function markdownFieldsTransform(ops) {
  return taggedTransform('structured-config', (content) =>
    ops.reduce((acc, op) => setMarkdownField(acc, op), content)
  )
}

/** `content => content` applying a list of `{ regex, value }` single-capture-group line patches in order. */
export function linePatchesTransform(ops) {
  return taggedTransform('structured-config', (content) =>
    ops.reduce((acc, op) => replaceCapturedField(acc, op.regex, op.value), content)
  )
}

/** `content => content` parsing JSON, setting dotted-path keys, and re-serializing at 2-space indent. */
export function jsonPatchTransform(patches) {
  return taggedTransform('structured-config', (content) => {
    const obj = JSON.parse(content)
    for (const [key, value] of Object.entries(patches)) setJsonPath(obj, key, value)
    return `${JSON.stringify(obj, null, 2)}\n`
  })
}

/** `content => content` parsing JSON, deleting dotted-path keys, and re-serializing at 2-space indent. */
export function jsonDeleteTransform(paths) {
  return taggedTransform('structured-config', (content) => {
    const obj = JSON.parse(content)
    for (const path of paths) deleteJsonPath(obj, path)
    return `${JSON.stringify(obj, null, 2)}\n`
  })
}
