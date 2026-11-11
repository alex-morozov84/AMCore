const gib = 1024n ** 3n

export const managedReadiness = Object.freeze({ path: '/', threshold: '0.9' })

export function supportsManagedReadiness(contract) {
  return contract?.path === '/' && contract?.threshold === '0.9'
}

export function capacityDecision(
  { bytes, freeBytes, inodes, freeInodes },
  contract = managedReadiness
) {
  if (!supportsManagedReadiness(contract)) return { skip: false, reason: 'unsupported-readiness' }
  const values = [bytes, freeBytes, inodes, freeInodes]
  if (
    values.some((value) => typeof value !== 'bigint' || value <= 0n) ||
    freeBytes > bytes ||
    freeInodes > inodes
  )
    return { skip: false, reason: 'invalid-counters' }
  const evidence = { bytes, freeBytes, inodes, freeInodes, readiness: contract.threshold }
  if (freeBytes < 80n * gib || 10n * freeBytes < 400n * gib + bytes)
    return { ...evidence, skip: false, reason: 'byte-reserve' }
  if (5n * freeInodes < 4n * inodes || 20n * freeInodes < 40000000n + inodes)
    return { ...evidence, skip: false, reason: 'inode-reserve' }
  return { ...evidence, skip: true, reason: 'admitted-capacity' }
}
