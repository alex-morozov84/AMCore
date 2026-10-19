import { docsPageHref } from '@/shared/lib/console-docs-links'

/**
 * Public operator guide for the queue board (section "Enabling the board"). The upstream address is
 * the default; a downstream product that publishes its own copy of the documentation points
 * `DOCS_REPOSITORY_URL` at it. Deliberately not an environment variable or a scaffold parameter.
 */
export const QUEUE_BOARD_GUIDE_HREF = docsPageHref(
  'docs/operations-console/queue-board.md',
  'enabling-the-board'
)
