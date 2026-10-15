import type { StorageService } from '../../infrastructure/storage/index.js'

/**
 * The public URL of a stored avatar key, or `null` for no avatar. The database keeps only the
 * key; every response computes the URL here, so changing `STORAGE_PUBLIC_BASE_URL` or the
 * delivery mode changes responses without a data migration. One mapper for auth, OAuth and admin.
 */
export function avatarUrlOf(
  storage: Pick<StorageService, 'getPublicUrl'>,
  avatarKey: string | null | undefined
): string | null {
  return avatarKey ? storage.getPublicUrl(avatarKey) : null
}
