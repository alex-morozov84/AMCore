import { ContextRequestError } from './context-errors'
import { oauthCompletionSchema } from './oauth-completion-input'

import 'server-only'

/** Count bytes before decoding; neither Content-Length nor formData allocates authority. */
async function readFormText(body: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!body) throw new ContextRequestError(400, 'BAD_REQUEST')
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let size = 0
  let text = ''
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    void reader.cancel().catch(() => undefined)
  }, 5000)
  try {
    for (;;) {
      const chunk = await reader.read()
      if (timedOut) throw new ContextRequestError(408, 'BAD_REQUEST')
      if (chunk.done) return text + decoder.decode()
      size += chunk.value.byteLength
      if (size > 8192) throw new ContextRequestError(413, 'PAYLOAD_TOO_LARGE')
      text += decoder.decode(chunk.value, { stream: true })
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    if (error instanceof ContextRequestError) throw error
    throw new ContextRequestError(400, 'BAD_REQUEST')
  } finally {
    clearTimeout(timer)
    reader.releaseLock()
  }
}

export async function readOAuthCompletion(request: Request) {
  if (
    !/^application\/x-www-form-urlencoded(?:;\s*charset=(?:utf-8|"utf-8"))?$/i.test(
      request.headers.get('content-type') ?? ''
    )
  )
    throw new ContextRequestError(415, 'BAD_REQUEST')
  const form = new URLSearchParams(await readFormText(request.body))
  if (form.size !== 2 || form.getAll('ticket').length !== 1 || form.getAll('locale').length !== 1)
    throw new ContextRequestError(400, 'BAD_REQUEST')
  const parsed = oauthCompletionSchema.safeParse(Object.fromEntries(form))
  if (!parsed.success) throw new ContextRequestError(400, 'BAD_REQUEST')
  return parsed.data
}
