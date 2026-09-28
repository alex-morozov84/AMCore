import type { ManagedTarget } from './managed-target.mjs'
export function rawOwnedRequest(
  target: Pick<ManagedTarget, 'origins' | 'caFile'>,
  baseURL: string,
  path: string
): Promise<{ status: number; body: string }>
