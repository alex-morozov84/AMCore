import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

import express from 'express'
import request from 'supertest'

import { installBoardDisplayAssets, withBoardDisplayStyle } from './bull-board-display-assets'

const nativeRequire = createRequire(resolve(process.cwd(), 'package.json'))
const apiRequire = createRequire(nativeRequire.resolve('@bull-board/api'))
const directory = join(dirname(apiRequire.resolve('@bull-board/ui/package.json')), 'dist/static')

describe('installed Board truthful display seam', () => {
  it.each([
    ['en-US', 'Not displayed'],
    ['en-GB', 'Not displayed'],
    ['ru-RU', 'Не отображается'],
  ])('transforms only the installed %s diagnostic placeholder', async (locale, copy) => {
    const app = express()
    installBoardDisplayAssets(app, '/static', directory)
    const response = await request(app).get(`/static/locales/${locale}/messages.json`).expect(200)
    expect(response.body.QUEUE.INFO.NOT_SET).toBe(copy)
    expect(response.body.MENU.QUEUES).toBeDefined()
  })

  it('serves one pinned scoped flow stylesheet, with no executable custom asset', async () => {
    const app = express()
    installBoardDisplayAssets(app, '/static', directory)
    const response = await request(app).get('/static/amcore-board-display.css').expect(200)
    expect(response.headers['content-type']).toContain('text/css')
    expect(response.text).toBe('.jobFlowCard-Y7apDE{display:none!important}')
    await request(app).get('/static/amcore-board-display.js').expect(404)
  })

  it('disables the installed defaults query for read-only queues without opening its API', async () => {
    const app = express()
    installBoardDisplayAssets(app, '/static', directory)
    const response = await request(app).get('/static/js/async/g.ff87bf7356.js').expect(200)
    expect(response.text).toContain('(a.name,l&&!a.readOnlyMode),w=Object.entries(k||{})')
    expect(response.text).not.toContain('(a.name,l),w=Object.entries(k||{})')
  })

  it.each(['/admin/queues', '/api/console/bull-board', '/api/console/bull-board/'])(
    'renders the stylesheet under the validated public base %s',
    (base) => {
      expect(withBoardDisplayStyle('<head></head><body></body>', base)).toContain(
        `href="${base.replace(/\/$/, '')}/static/amcore-board-display.css"`
      )
    }
  )

  it.each(['https://evil.test', '/api/"onclick=', '/api/<script>'])('rejects %s', (base) => {
    expect(() => withBoardDisplayStyle('<head></head>', base)).toThrow(
      'BOARD_DISPLAY_UPGRADE_REQUIRED'
    )
  })

  it('fails closed on a changed HTML seam rather than emitting a misleading board', () => {
    expect(() => withBoardDisplayStyle('<body>changed</body>', '/admin/queues')).toThrow(
      'BOARD_DISPLAY_UPGRADE_REQUIRED'
    )
  })
})
