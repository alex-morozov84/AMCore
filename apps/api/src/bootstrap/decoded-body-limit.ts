import { type Readable, Transform } from 'node:stream'

import { PayloadTooLargeException } from '../common/exceptions/domain/index.js'

type EncodedStream = Readable & { receivedEncodedLength?: number }

/** Bounds decoded bytes before the parser buffers them, preserving encoded length accounting. */
export function decodedBodyLimit(payload: EncodedStream, limit: number): Transform {
  let bytes = 0
  const bounded = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length
      if (bytes > limit) {
        callback(
          new PayloadTooLargeException('Request body exceeds the maximum allowed size', {
            limitBytes: limit,
          })
        )
      } else {
        callback(null, chunk)
      }
    },
  })
  Object.defineProperty(bounded, 'receivedEncodedLength', {
    get: () => payload.receivedEncodedLength ?? bytes,
  })
  const forwardError = (error: Error): void => {
    bounded.destroy(error)
  }
  payload.on('error', forwardError)
  bounded.once('close', () => {
    payload.unpipe(bounded)
    payload.removeListener('error', forwardError)
  })
  return payload.pipe(bounded)
}
