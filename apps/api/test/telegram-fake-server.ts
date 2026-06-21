import http from 'node:http'

/** A local HTTP stand-in for the Telegram Bot API (`TELEGRAM_API_BASE_URL` points here in e2e). */
export interface FakeTelegram {
  url: string
  close: () => Promise<void>
  /** Set the next `sendMessage` HTTP status + body (default `200 {ok:true,result:{message_id:1}}`). */
  setSendResponse: (status: number, body: unknown) => void
  /** Bodies of every `sendMessage` POST observed, in order. */
  sendCalls: { chat_id?: string; text?: string }[]
}

export async function startFakeTelegram(): Promise<FakeTelegram> {
  let send = { status: 200, body: { ok: true, result: { message_id: 1 } } as unknown }
  const sendCalls: { chat_id?: string; text?: string }[] = []
  const server = http.createServer((req, res) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      const isSend = (req.url ?? '').endsWith('/sendMessage')
      if (isSend && data) sendCalls.push(JSON.parse(data) as { chat_id?: string; text?: string })
      res.writeHead(isSend ? send.status : 200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(isSend ? send.body : { ok: true, result: true }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
    setSendResponse: (status, body) => (send = { status, body }),
    sendCalls,
  }
}
