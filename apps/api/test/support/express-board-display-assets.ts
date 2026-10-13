import type { Express } from 'express'

import {
  BOARD_DISPLAY_CSS,
  FLOW_CSS,
  INFO_ASSET,
  readBoardDisplayAssets,
} from '../../src/infrastructure/queue/dashboard/bull-board-display-assets'

/** Install only after every before-mount validation succeeds. */
export function installBoardDisplayAssets(app: Express, route: string, directory: string): void {
  const { readOnlyInfo, assets } = readBoardDisplayAssets(directory)
  app.get(`${route}/${INFO_ASSET}`, (_req, res) => res.type('js').send(readOnlyInfo))
  for (const { locale, messages } of assets)
    app.get(`${route}/locales/${locale}/messages.json`, (_req, res) => res.json(messages))
  app.get(`${route}/${BOARD_DISPLAY_CSS}`, (_req, res) => res.type('css').send(FLOW_CSS))
}
