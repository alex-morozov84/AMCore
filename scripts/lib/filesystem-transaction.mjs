import {
  describeFilesystemError,
  FilesystemApplyError,
  FilesystemTransactionError,
  TRANSACTION_CODES,
} from './filesystem-transaction-errors.mjs'
import {
  filesystemTransactionJournalPath,
  publishFilesystemJournal,
  removeFilesystemJournal,
  transitionFilesystemJournal,
} from './filesystem-transaction-journal.mjs'
import { applyFilesystemOperation } from './filesystem-transaction-operations.mjs'
import { preflightFilesystemTransaction } from './filesystem-transaction-preflight.mjs'
import { rollbackFilesystemOperations } from './filesystem-transaction-rollback.mjs'

/**
 * @typedef {{kind: 'write', target: string, bytes: Buffer, mode?: number} |
 * {kind: 'delete', target: string} |
 * {kind: 'move', from: string, to: string, bytes?: Buffer, mode?: number}} FilesystemOperation
 */

export {
  FilesystemApplyError,
  FilesystemTransactionError,
  PendingFilesystemTransactionError,
  TRANSACTION_CODES,
  recoveryInstructions,
} from './filesystem-transaction-errors.mjs'
export {
  filesystemTransactionJournalPath,
  readFilesystemTransactionJournal,
} from './filesystem-transaction-journal.mjs'
export { preflightFilesystemTransaction } from './filesystem-transaction-preflight.mjs'

function recordJournalError(errors, error) {
  errors.push(new Error(`journal update failed: ${error.message}`, { cause: error }))
}

function tryTransition(root, journal, state, detail, errors) {
  try {
    return transitionFilesystemJournal(root, journal, state, detail)
  } catch (error) {
    recordJournalError(errors, error)
    return journal
  }
}

function finishRollback(root, journal, errors, applyError, failedIndex) {
  const state = errors.length ? 'rollback-failed' : 'rolled-back'
  journal = tryTransition(
    root,
    journal,
    state,
    {
      failedStep: failedIndex,
      applyError: describeFilesystemError(applyError),
      rollbackErrors: errors.map(describeFilesystemError),
    },
    errors
  )
  if (!errors.length) {
    try {
      removeFilesystemJournal(root)
    } catch (error) {
      recordJournalError(errors, error)
    }
  }
  return journal
}

function handleApplyFailure(root, journal, failedIndex, applyError, hooks) {
  const errors = []
  journal = tryTransition(
    root,
    journal,
    'rolling-back',
    { failedStep: failedIndex, applyError: describeFilesystemError(applyError) },
    errors
  )
  errors.push(...rollbackFilesystemOperations(root, journal, failedIndex, hooks))
  finishRollback(root, journal, errors, applyError, failedIndex)
  throw new FilesystemApplyError(applyError, errors, filesystemTransactionJournalPath(root))
}

function applyOperations(root, operations, journal, hooks) {
  let current = journal
  let failedIndex = -1
  try {
    const published = hooks.afterJournalPublished ? JSON.parse(JSON.stringify(current)) : undefined
    hooks.afterJournalPublished?.({ journal: published })
    current = transitionFilesystemJournal(root, current, 'applying', { currentStep: 0 })
    for (let index = 0; index < operations.length; index += 1) {
      failedIndex = index
      current = transitionFilesystemJournal(root, current, 'applying', { currentStep: index })
      hooks.beforeMutation?.({ index })
      applyFilesystemOperation(root, operations[index], current.undoRecords[index], hooks, index)
      hooks.afterMutation?.({ index })
    }
    return current
  } catch (error) {
    handleApplyFailure(root, current, failedIndex, error, hooks)
  }
}

function commit(root, journal, hooks) {
  let committed
  try {
    committed = transitionFilesystemJournal(root, journal, 'committed', {
      currentStep: journal.operations.length,
    })
  } catch (error) {
    handleApplyFailure(root, journal, journal.operations.length - 1, error, hooks)
  }
  try {
    removeFilesystemJournal(root)
  } catch (error) {
    throw new FilesystemTransactionError(
      TRANSACTION_CODES.FINALIZE_FAILED,
      `filesystem committed but journal cleanup failed: ${error.message}`,
      { cause: error }
    )
  }
  return committed.transactionId
}

/**
 * Applies already-materialized filesystem intent. Array order is execution
 * order. Preflight and the complete undo journal finish before the first
 * target mutation; any journal left by a crash blocks a later invocation.
 * Crash recovery is deliberately manual; this does not promise rollback
 * after process termination or arbitrary power-loss atomicity.
 * @param {{root: string, operations: FilesystemOperation[], hooks?: object}} input
 */
export function applyFilesystemTransaction({ root: rawRoot, operations, hooks = {} } = {}) {
  const prepared = preflightFilesystemTransaction(rawRoot, operations)
  publishFilesystemJournal(prepared.root, prepared.journal, { exclusive: true })
  const applied = applyOperations(prepared.root, prepared.operations, prepared.journal, hooks)
  return { transactionId: commit(prepared.root, applied, hooks), applied: operations.length }
}
