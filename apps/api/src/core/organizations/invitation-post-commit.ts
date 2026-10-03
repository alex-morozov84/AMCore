/** Acknowledged writes never wait indefinitely for optional Redis operations. */
export const INVITATION_POST_COMMIT_TIMEOUT_MS = 250

export async function invitationPostCommit(
  work: () => Promise<void>
): Promise<'failed' | 'timeout' | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve()
        .then(work)
        .then(
          () => undefined,
          () => 'failed' as const
        ),
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), INVITATION_POST_COMMIT_TIMEOUT_MS)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
