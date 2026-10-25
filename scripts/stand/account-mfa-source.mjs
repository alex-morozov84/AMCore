import { copyFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/** Replace only the client adapter in an owned snapshot; never enable backend MFA. */
export async function prepareAccountMfaPreview(m) {
  if (m.fixtureProfile !== 'account-mfa-ui') return
  if (m.purpose !== 'preview' || m.mocked || resolve(m.snapshot) === resolve(m.worktree))
    throw new Error('Account MFA UI requires its own managed Docker preview snapshot')
  const source = join(m.snapshot, 'docker/testing/account-mfa')
  const target = join(m.snapshot, 'apps/web/src/_app/account-security/ui')
  await copyFile(join(source, 'preview-client.tsx'), join(target, 'client.tsx'))
  await copyFile(join(source, 'preview-adapter.ts'), join(target, 'preview-adapter.ts'))
}
