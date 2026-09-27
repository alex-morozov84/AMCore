import { NotFoundException } from '../../common/exceptions'
import { PrismaService } from '../../prisma'

import { OrgAclVersionService } from './org-acl-version.service'

describe('OrgAclVersionService', () => {
  const findUnique = jest.fn()
  let service: OrgAclVersionService

  beforeEach(() => {
    findUnique.mockReset()
    service = new OrgAclVersionService({ organization: { findUnique } } as unknown as PrismaService)
  })

  it('reads the current version on every request, including version zero', async () => {
    findUnique.mockResolvedValueOnce({ aclVersion: 0 }).mockResolvedValueOnce({ aclVersion: 1 })
    await expect(service.getCurrent('org')).resolves.toBe(0)
    await expect(service.getCurrent('org')).resolves.toBe(1)
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'org' }, select: { aclVersion: true } })
    expect(service.getMetrics()).toEqual({ dbQueries: 2 })
  })

  it('rejects missing organizations rather than using historical authority', async () => {
    findUnique.mockResolvedValue(null)
    await expect(service.getCurrent('missing')).rejects.toThrow(NotFoundException)
  })

  it('propagates database failures without a cached fallback', async () => {
    const failure = new Error('primary unavailable')
    findUnique.mockRejectedValue(failure)
    await expect(service.getCurrent('org')).rejects.toBe(failure)
  })

  it('keeps invalidation as an inert compatibility seam', async () => {
    await expect(service.invalidate('org')).resolves.toBeUndefined()
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('resets query accounting', async () => {
    findUnique.mockResolvedValue({ aclVersion: 3 })
    await service.getCurrent('org')
    service.resetMetrics()
    expect(service.getMetrics()).toEqual({ dbQueries: 0 })
  })
})
