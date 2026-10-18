import { docsPageHref } from '@/shared/lib/console-docs-links'

/**
 * Public runbook section for the exposed-private-files alert. The upstream address is the default;
 * a downstream product that publishes its own copy of the documentation points
 * `DOCS_REPOSITORY_URL` at it. Deliberately not an environment variable or a scaffold parameter.
 */
export const PRIVATE_EXPOSURE_RUNBOOK_HREF = docsPageHref(
  'docs/operations/runbooks/storage.md',
  'private-exposure'
)
