export const TRANSACTION_CODES = Object.freeze({
  INVALID_OPERATION: 'invalid-filesystem-operation',
  INVALID_SHAPE: 'unsupported-filesystem-shape',
  PATH_CONFLICT: 'filesystem-path-conflict',
  PENDING: 'pending-filesystem-transaction',
  APPLY_FAILED: 'filesystem-apply-failed',
  FINALIZE_FAILED: 'filesystem-finalize-failed',
})

export class FilesystemTransactionError extends Error {
  constructor(code, detail, { paths = [], cause } = {}) {
    super(`${code}: ${detail}`, { cause })
    this.name = 'FilesystemTransactionError'
    this.code = code
    this.paths = [...new Set(paths)].sort()
  }
}

export function describeFilesystemError(error) {
  return {
    name: error?.name ?? 'Error',
    message: error?.message ?? String(error),
    ...(error?.code === undefined ? {} : { code: error.code }),
  }
}

export function recoveryInstructions(journalPath) {
  return [
    `preserve ${journalPath} and the transaction root`,
    'inspect its operation-scoped undo records',
    'restore recorded states in reverse operation order',
    'verify the tree independently',
    'remove the journal only after that verification',
  ].join('; ')
}

export class PendingFilesystemTransactionError extends FilesystemTransactionError {
  constructor(journalPath, state = 'unknown') {
    super(
      TRANSACTION_CODES.PENDING,
      `journal ${journalPath} is in state "${state}"; new apply is blocked; ${recoveryInstructions(journalPath)}`
    )
    this.name = 'PendingFilesystemTransactionError'
    this.journalPath = journalPath
    this.state = state
  }
}

export class FilesystemApplyError extends FilesystemTransactionError {
  constructor(applyError, rollbackErrors, journalPath) {
    const restored = rollbackErrors.length === 0
    const rollback = restored
      ? 'rollback completed and the initial filesystem snapshot was restored'
      : `rollback failed: ${rollbackErrors.map((error) => error.message).join('; ')}`
    super(TRANSACTION_CODES.APPLY_FAILED, `apply failed: ${applyError.message}; ${rollback}`, {
      cause: applyError,
    })
    this.name = 'FilesystemApplyError'
    this.applyError = applyError
    this.rollbackErrors = rollbackErrors
    this.restored = restored
    this.journalPath = journalPath
  }
}
