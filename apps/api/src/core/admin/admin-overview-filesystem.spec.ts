import { filesystemAmounts } from './admin-overview-filesystem'

describe('Overview filesystem amounts', () => {
  it('uses unprivileged available blocks and includes reserved space in pressure', () => {
    expect(filesystemAmounts({ blocks: 100n, bavail: 40n, bsize: 4096n })).toEqual({
      path: '/',
      totalBytes: 409600,
      availableBytes: 163840,
      pressureRatio: 0.6,
    })
  })

  it.each([
    { blocks: 0n, bavail: 0n, bsize: 4096n },
    { blocks: 1n, bavail: -1n, bsize: 4096n },
    { blocks: 1n, bavail: 2n, bsize: 4096n },
    { blocks: 1n, bavail: 0n, bsize: 0n },
    { blocks: -1n, bavail: 0n, bsize: -1n },
    { blocks: BigInt(Number.MAX_SAFE_INTEGER), bavail: 0n, bsize: 2n },
  ])('rejects impossible or unsafe byte arithmetic: %p', (stats) => {
    expect(() => filesystemAmounts(stats)).toThrow('Invalid filesystem sample')
  })
})
