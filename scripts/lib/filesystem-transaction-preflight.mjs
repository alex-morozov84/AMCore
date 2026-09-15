import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { FilesystemTransactionError, TRANSACTION_CODES } from './filesystem-transaction-errors.mjs'
import { assertNoFilesystemTransaction } from './filesystem-transaction-journal.mjs'
import {
  absoluteEndpoint,
  inspectParents,
  resolveTransactionRoot,
} from './filesystem-transaction-paths.mjs'
import { captureFilesystemState } from './filesystem-transaction-snapshot.mjs'
import { validateFilesystemOperations } from './filesystem-transaction-validate.mjs'

function relativeParent(root, absolute) {
  return path.relative(root, absolute).replaceAll('\\', '/')
}

function inspectEndpoint(root, relative) {
  const missingParents = inspectParents(root, relative).map((item) => relativeParent(root, item))
  const state = captureFilesystemState(absoluteEndpoint(root, relative))
  return { state, missingParents }
}

function assertWriteShape(operation, inspected) {
  if (inspected.state.kind !== 'directory') return
  throw new FilesystemTransactionError(
    TRANSACTION_CODES.INVALID_SHAPE,
    `write target is a directory: ${operation.target}`,
    { paths: [operation.target] }
  )
}

function inspectMove(root, operation, index) {
  const source = inspectEndpoint(root, operation.from)
  const destination = inspectEndpoint(root, operation.to)
  if (source.state.kind === 'missing') {
    throw new FilesystemTransactionError(
      TRANSACTION_CODES.INVALID_SHAPE,
      `move source does not exist: ${operation.from}`,
      { paths: [operation.from] }
    )
  }
  if (operation.bytes && source.state.kind !== 'file') {
    throw new FilesystemTransactionError(
      TRANSACTION_CODES.INVALID_SHAPE,
      `move with replacement bytes requires a regular-file source: ${operation.from}`,
      { paths: [operation.from] }
    )
  }
  return {
    record: {
      index,
      kind: 'move',
      from: operation.from,
      to: operation.to,
      sourceBefore: source.state,
      destinationBefore: destination.state,
    },
    parents: destination.missingParents,
  }
}

function inspectOperation(root, operation, index) {
  if (operation.kind === 'move') return inspectMove(root, operation, index)
  const target = inspectEndpoint(root, operation.target)
  if (operation.kind === 'write') assertWriteShape(operation, target)
  return {
    record: { index, kind: operation.kind, target: operation.target, before: target.state },
    parents: operation.kind === 'write' ? target.missingParents : [],
  }
}

function journalOperation(operation) {
  if (operation.kind === 'delete') return operation
  return {
    kind: operation.kind,
    ...(operation.kind === 'write'
      ? { target: operation.target }
      : { from: operation.from, to: operation.to }),
    ...(operation.bytes ? { bytesLength: operation.bytes.length } : {}),
    ...(operation.mode === undefined ? {} : { mode: operation.mode }),
  }
}

export function preflightFilesystemTransaction(rawRoot, rawOperations) {
  const root = resolveTransactionRoot(rawRoot)
  assertNoFilesystemTransaction(root)
  const operations = validateFilesystemOperations(rawOperations)
  const inspected = operations.map((operation, index) => inspectOperation(root, operation, index))
  const createdParents = [...new Set(inspected.flatMap((item) => item.parents))].sort()
  const now = new Date().toISOString()
  return {
    root,
    operations,
    journal: {
      version: 1,
      transactionId: randomUUID(),
      state: 'prepared',
      createdAt: now,
      updatedAt: now,
      operations: operations.map(journalOperation),
      undoRecords: inspected.map((item) => item.record),
      createdParents,
    },
  }
}
