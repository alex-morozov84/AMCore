import { statfs } from 'node:fs/promises'

type FilesystemAmounts = {
  path: '/'
  totalBytes: number
  availableBytes: number
  pressureRatio: number
}

/** Fixed local API root. Bigint arithmetic is validated before JSON conversion. */
export async function sampleOverviewFilesystem(): Promise<FilesystemAmounts> {
  const stats = await statfs('/', { bigint: true })
  return filesystemAmounts(stats)
}

export function filesystemAmounts(stats: {
  blocks: bigint
  bavail: bigint
  bsize: bigint
}): FilesystemAmounts {
  const total = stats.blocks * stats.bsize
  const available = stats.bavail * stats.bsize
  const maximum = BigInt(Number.MAX_SAFE_INTEGER)
  if (stats.bsize <= 0n || total <= 0n || available < 0n || available > total || total > maximum) {
    throw new Error('Invalid filesystem sample')
  }
  return {
    path: '/' as const,
    totalBytes: Number(total),
    availableBytes: Number(available),
    pressureRatio: Number(total - available) / Number(total),
  }
}
