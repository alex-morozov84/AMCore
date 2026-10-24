import type { Prisma } from '../../generated/prisma/client'

import { readLoginDiagnostics } from './admin-login-diagnostics'

it('returns only setup facts and scopes both aggregates to the requested user', async () => {
  const tx = {
    user: { count: jest.fn().mockResolvedValue(1) },
    oAuthAccount: {
      groupBy: jest.fn().mockResolvedValue([{ provider: 'GOOGLE' }, { provider: 'TELEGRAM' }]),
    },
  }
  const result = await readLoginDiagnostics(
    tx as unknown as Prisma.TransactionClient,
    'target-user'
  )
  expect(result).toEqual({ hasPassword: true, linkedProviders: ['google', 'telegram'] })
  expect(tx.user.count).toHaveBeenCalledWith({
    where: { id: 'target-user', passwordHash: { not: null }, NOT: { passwordHash: '' } },
  })
  expect(tx.oAuthAccount.groupBy).toHaveBeenCalledWith({
    by: ['provider'],
    where: { userId: 'target-user' },
    orderBy: { provider: 'asc' },
  })
})

it('does not turn an aggregate failure into false absence', async () => {
  const tx = {
    user: { count: jest.fn().mockResolvedValue(0) },
    oAuthAccount: { groupBy: jest.fn().mockRejectedValue(new Error('database unavailable')) },
  }
  await expect(
    readLoginDiagnostics(tx as unknown as Prisma.TransactionClient, 'target-user')
  ).rejects.toThrow('database unavailable')
})
