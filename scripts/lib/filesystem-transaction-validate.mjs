import { isAncestor } from './path-algebra-normalize.mjs'
import { FilesystemTransactionError, TRANSACTION_CODES } from './filesystem-transaction-errors.mjs'
import { JOURNAL_NAME } from './filesystem-transaction-journal.mjs'
import { normalizeEndpoint } from './filesystem-transaction-paths.mjs'

const OPERATION_KINDS = new Set(['write', 'delete', 'move'])

function invalid(detail, paths = []) {
  throw new FilesystemTransactionError(TRANSACTION_CODES.INVALID_OPERATION, detail, { paths })
}

function validateMode(mode) {
  if (mode === undefined) return
  if (!Number.isInteger(mode) || mode < 0 || mode > 0o7777) invalid('write mode is invalid')
}

function endpointsOf(operation) {
  return operation.kind === 'move'
    ? [
        { role: 'source', path: operation.from },
        { role: 'destination', path: operation.to },
      ]
    : [{ role: 'target', path: operation.target }]
}

function validateOperation(raw, index) {
  if (!raw || typeof raw !== 'object' || !OPERATION_KINDS.has(raw.kind)) {
    invalid(`operation #${index} has an unsupported kind`)
  }
  const rewritesMove = raw.kind === 'move' && raw.bytes !== undefined
  if ((raw.kind === 'write' || rewritesMove) && !Buffer.isBuffer(raw.bytes)) {
    invalid(`${raw.kind} operation #${index} requires Buffer bytes`)
  }
  if (raw.kind === 'move' && raw.mode !== undefined && !rewritesMove) {
    invalid(`move operation #${index} cannot set mode without replacement bytes`)
  }
  validateMode(raw.mode)
  const normalized = { ...raw }
  if (raw.bytes !== undefined) normalized.bytes = Buffer.from(raw.bytes)
  if (raw.kind === 'move') {
    normalized.from = normalizeEndpoint(raw.from)
    normalized.to = normalizeEndpoint(raw.to)
    if (normalized.from === normalized.to) invalid(`move operation #${index} has equal endpoints`)
    if (isAncestor(normalized.from, normalized.to) || isAncestor(normalized.to, normalized.from)) {
      invalid(`move operation #${index} has nested endpoints`, [normalized.from, normalized.to])
    }
  } else {
    normalized.target = normalizeEndpoint(raw.target)
  }
  return normalized
}

function allowedExtraction(left, right, operations) {
  const deletion = [left, right].find(
    (endpoint) => endpoint.role === 'target' && operations[endpoint.index].kind === 'delete'
  )
  const source = left.role === 'source' ? left : right.role === 'source' ? right : undefined
  if (!deletion || !source || !isAncestor(deletion.path, source.path)) return false
  const move = operations[source.index]
  return source.index < deletion.index && !isAncestor(deletion.path, move.to)
}

function assertRelationships(operations) {
  const endpoints = operations.flatMap((operation, index) =>
    endpointsOf(operation).map((endpoint) => ({ ...endpoint, index }))
  )
  for (let left = 0; left < endpoints.length; left += 1) {
    for (let right = left + 1; right < endpoints.length; right += 1) {
      const a = endpoints[left]
      const b = endpoints[right]
      if (a.index === b.index) continue
      const related = a.path === b.path || isAncestor(a.path, b.path) || isAncestor(b.path, a.path)
      if (related && !allowedExtraction(a, b, operations)) {
        invalid(`operations #${a.index} and #${b.index} have unsupported overlapping paths`, [
          a.path,
          b.path,
        ])
      }
    }
  }
}

export function validateFilesystemOperations(rawOperations) {
  if (!Array.isArray(rawOperations) || rawOperations.length === 0) {
    invalid('operations must be a non-empty array')
  }
  const operations = rawOperations.map(validateOperation)
  const reserved = operations
    .flatMap(endpointsOf)
    .find(
      (endpoint) =>
        endpoint.path === JOURNAL_NAME ||
        endpoint.path.startsWith(`${JOURNAL_NAME}.`) ||
        endpoint.path.startsWith(`${JOURNAL_NAME}/`)
    )
  if (reserved) invalid(`${JOURNAL_NAME} is reserved for transaction recovery`)
  assertRelationships(operations)
  return operations
}
