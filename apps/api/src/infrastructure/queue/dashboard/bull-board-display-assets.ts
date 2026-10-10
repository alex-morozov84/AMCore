import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import type { Express } from 'express'
import { z } from 'zod'

import { boardCopy } from './bull-board-copy'

const translationsSchema = z
  .object({
    QUEUE: z
      .object({ INFO: z.object({ NOT_SET: z.string().max(100) }).passthrough() })
      .passthrough(),
  })
  .passthrough()
const LOCALES = ['en-US', 'en-GB', 'ru-RU'] as const
const FLOW_ASSET = 'js/async/8.f93064bab2.js'
const FLOW_SHA256 = '204dea1cda0cb8f792d43cc182b3e68fbe202a1ffbe248837d412688299aee19'
const FLOW_CSS = '.jobFlowCard-Y7apDE{display:none!important}'
const INFO_ASSET = 'js/async/g.ff87bf7356.js'
const INFO_SHA256 = 'a0a6b6b231fa1e69e7ebe03174526b1f7e32d28cc19696a0e8e0f245dbdcdc4c'
const DEFAULTS_QUERY = '(a.name,l),w=Object.entries(k||{})'
export const BOARD_DISPLAY_CSS = 'amcore-board-display.css'

/** Fixed installed assets only; mismatched version/selector/translation shape prevents mounting. */
export function installBoardDisplayAssets(app: Express, route: string, directory: string): void {
  const flowPath = join(directory, FLOW_ASSET)
  if (statSync(flowPath).size > 262144) throw new Error('BOARD_DISPLAY_UPGRADE_REQUIRED')
  const flow = readFileSync(flowPath)
  if (createHash('sha256').update(flow).digest('hex') !== FLOW_SHA256)
    throw new Error('BOARD_DISPLAY_UPGRADE_REQUIRED')
  const infoPath = join(directory, INFO_ASSET)
  if (statSync(infoPath).size > 32768) throw new Error('BOARD_DISPLAY_UPGRADE_REQUIRED')
  const info = readFileSync(infoPath)
  const infoSource = info.toString('utf8')
  if (
    createHash('sha256').update(info).digest('hex') !== INFO_SHA256 ||
    infoSource.split(DEFAULTS_QUERY).length !== 2
  )
    throw new Error('BOARD_DISPLAY_UPGRADE_REQUIRED')
  // The installed dialog fetches defaults even in read-only mode. Keep that channel closed:
  // disable its query for this projected read-only queue; no defaults section is rendered.
  const readOnlyInfo = infoSource.replace(
    DEFAULTS_QUERY,
    '(a.name,l&&!a.readOnlyMode),w=Object.entries(k||{})'
  )
  const assets = LOCALES.map((locale) => {
    const filename = join(directory, 'locales', locale, 'messages.json')
    if (statSync(filename).size > 65536) throw new Error('BOARD_DISPLAY_UPGRADE_REQUIRED')
    const messages = translationsSchema.parse(JSON.parse(readFileSync(filename, 'utf8')))
    messages.QUEUE.INFO.NOT_SET = boardCopy(locale === 'ru-RU' ? 'ru' : 'en').notDisplayed
    return { locale, messages }
  })
  // Install only after every before-mount validation succeeds.
  app.get(`${route}/${INFO_ASSET}`, (_req, res) => res.type('js').send(readOnlyInfo))
  for (const { locale, messages } of assets)
    app.get(`${route}/locales/${locale}/messages.json`, (_req, res) => res.json(messages))
  app.get(`${route}/${BOARD_DISPLAY_CSS}`, (_req, res) => res.type('css').send(FLOW_CSS))
}

export function withBoardDisplayStyle(html: string, basePath: string): string {
  if (!/^\/[A-Za-z0-9_/-]{1,200}$/.test(basePath) || html.split('</head>').length !== 2)
    throw new Error('BOARD_DISPLAY_UPGRADE_REQUIRED')
  const href = `${basePath.replace(/\/$/, '')}/static/${BOARD_DISPLAY_CSS}`
  return html.replace('</head>', `<link rel="stylesheet" href="${href}"></head>`)
}
