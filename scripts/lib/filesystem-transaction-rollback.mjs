import { rmdirSync } from 'node:fs'

import { absoluteEndpoint } from './filesystem-transaction-paths.mjs'
import { restoreFilesystemState } from './filesystem-transaction-snapshot.mjs'

function restoreRecord(root, record) {
  if (record.kind !== 'move') {
    restoreFilesystemState(absoluteEndpoint(root, record.target), record.before)
    return
  }
  restoreFilesystemState(absoluteEndpoint(root, record.to), record.destinationBefore)
  restoreFilesystemState(absoluteEndpoint(root, record.from), record.sourceBefore)
}

function rollbackError(index, error) {
  const wrapped = new Error(`undo step #${index} failed: ${error.message}`, { cause: error })
  wrapped.stepIndex = index
  return wrapped
}

function removeCreatedParents(root, parents, errors) {
  const deepestFirst = [...parents].sort((a, b) => b.split('/').length - a.split('/').length)
  for (const relative of deepestFirst) {
    try {
      rmdirSync(absoluteEndpoint(root, relative))
    } catch (error) {
      if (error.code !== 'ENOENT') errors.push(rollbackError(`parent:${relative}`, error))
    }
  }
}

export function rollbackFilesystemOperations(root, journal, failedIndex, hooks = {}) {
  const errors = []
  for (let index = failedIndex; index >= 0; index -= 1) {
    try {
      hooks.beforeRollback?.({ index })
      restoreRecord(root, journal.undoRecords[index])
    } catch (error) {
      errors.push(rollbackError(index, error))
    }
  }
  removeCreatedParents(root, journal.createdParents, errors)
  return errors
}
