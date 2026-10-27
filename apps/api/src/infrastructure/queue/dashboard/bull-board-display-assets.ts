import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { z } from 'zod'

import { boardCopy } from './bull-board-copy.js'

const translationsSchema = z
  .object({
    QUEUE: z
      .object({ INFO: z.object({ NOT_SET: z.string().max(100) }).passthrough() })
      .passthrough(),
  })
  .passthrough()
const LOCALES = ['en-US', 'en-GB', 'ru-RU'] as const
const FLOW_ASSET = 'js/async/8.0350f20068.js'
const FLOW_SHA256 = 'dace65826b2eca6ea89eb87419315f5b14e61f9b420ffcc829da71f0df2672cc'
export const FLOW_CSS = '.jobFlowCard-Y7apDE{display:none!important}'
export const INFO_ASSET = 'js/async/oa.cadae521aa.js'
const INFO_SHA256 = '12c98c54fbc4134f4e3515449fe2a0e494ee7a00e8e08a653173adf3b9bac8ba'
const DEFAULTS_QUERY = '(a.name,l),_=Object.entries(L||{})'
export const BOARD_DISPLAY_CSS = 'amcore-board-display.css'

/** Fixed installed assets only; mismatched version/selector/translation shape prevents mounting. */
export function readBoardDisplayAssets(directory: string): {
  readOnlyInfo: string
  assets: Array<{ locale: string; messages: z.infer<typeof translationsSchema> }>
} {
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
    '(a.name,l&&!a.readOnlyMode),_=Object.entries(L||{})'
  )
  const assets = LOCALES.map((locale) => {
    const filename = join(directory, 'locales', locale, 'messages.json')
    if (statSync(filename).size > 65536) throw new Error('BOARD_DISPLAY_UPGRADE_REQUIRED')
    const messages = translationsSchema.parse(JSON.parse(readFileSync(filename, 'utf8')))
    messages.QUEUE.INFO.NOT_SET = boardCopy(locale === 'ru-RU' ? 'ru' : 'en').notDisplayed
    return { locale, messages }
  })
  return { readOnlyInfo, assets }
}

export function withBoardDisplayStyle(html: string, basePath: string): string {
  if (!/^\/[A-Za-z0-9_/-]{1,200}$/.test(basePath) || html.split('</head>').length !== 2)
    throw new Error('BOARD_DISPLAY_UPGRADE_REQUIRED')
  const href = `${basePath.replace(/\/$/, '')}/static/${BOARD_DISPLAY_CSS}`
  return html.replace('</head>', `<link rel="stylesheet" href="${href}"></head>`)
}
