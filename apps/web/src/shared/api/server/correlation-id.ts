import 'server-only'

/**
 * One correlation id per direct `apps/api` call from a Server Component.
 * Not propagated from the original browser request today — same as the
 * existing browser→BFF→`apps/api` path, where `apps/api` also generates its
 * own id when none is supplied (`docs/operations/observability.md`). Kept as
 * its own module so tests can stub it deterministically.
 */
export function generateCorrelationId(): string {
  return crypto.randomUUID()
}
