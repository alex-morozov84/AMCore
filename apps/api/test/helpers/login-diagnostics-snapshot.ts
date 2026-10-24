import type { Prisma } from '../../src/generated/prisma/client'
import type { PrismaService } from '../../src/prisma'

const jest = import.meta.jest

/** Pause after the actual target SELECT established the detail transaction's snapshot. */
export function holdLoginSnapshot(
  prisma: PrismaService,
  userId: string
): {
  ready: Promise<void>
  release: () => void
  restore: () => void
} {
  let entered!: () => void
  let release!: () => void
  const ready = new Promise<void>((resolve) => {
    entered = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const original = prisma.$transaction.bind(prisma)
  const spy = jest.spyOn(prisma, '$transaction').mockImplementation((async (
    work: (tx: Prisma.TransactionClient) => Promise<unknown>,
    options: { isolationLevel?: string }
  ) => {
    if (typeof work !== 'function' || options?.isolationLevel !== 'RepeatableRead')
      return original(work, options as never)
    return original(
      async (tx) =>
        work(
          new Proxy(tx, {
            get(target, key) {
              if (key !== 'user') return Reflect.get(target, key)
              return new Proxy(target.user, {
                get(model, name) {
                  if (name !== 'findUnique') return Reflect.get(model, name)
                  return async (args: Prisma.UserFindUniqueArgs) => {
                    const result = await model.findUnique(args)
                    if (args.where.id === userId) {
                      entered()
                      await gate
                    }
                    return result
                  }
                },
              })
            },
          })
        ),
      options as never
    )
  }) as never)
  return {
    ready,
    release,
    restore: () => {
      release()
      spy.mockRestore()
    },
  }
}
