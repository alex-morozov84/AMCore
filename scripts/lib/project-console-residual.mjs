import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { operationsConsoleOwnership } from './operations-console-ownership.mjs'
import { assertProjectionResiduals } from './ownership-residual.mjs'

function surfaceFiles(validation) {
  return new Set(
    [...validation.inventory.surface].filter(([, kind]) => kind === 'file').map(([file]) => file)
  )
}

function survivingFiles(validation, facts) {
  const files = surfaceFiles(validation)
  for (const fact of facts.filter((item) => item.kind === 'delete')) {
    for (const file of [...files]) {
      if (file === fact.path || file.startsWith(`${fact.path}/`)) files.delete(file)
    }
  }
  return files
}

function originalContents(root, files) {
  return new Map([...files].map((file) => [file, readFileSync(path.join(root, file), 'utf8')]))
}

export function virtualConsoleSurface(root, validation, facts, steps, omitted = []) {
  const files = survivingFiles(validation, facts)
  for (const file of omitted) files.delete(file)
  const contents = originalContents(root, files)
  for (const step of steps.filter((item) => item.kind === 'edit')) {
    const relative = path.relative(root, step.target).split(path.sep).join('/')
    contents.set(relative, step.after)
  }
  return { files, contents }
}

export function assertConsoleOwnershipApplied(root, validation) {
  const files = new Set(
    [...surfaceFiles(validation)].filter((file) => existsSync(path.join(root, file)))
  )
  const contents = originalContents(root, files)
  assertProjectionResiduals(
    [{ manifest: operationsConsoleOwnership, inventory: validation.inventory }],
    validation.projection,
    files,
    contents
  )
}
