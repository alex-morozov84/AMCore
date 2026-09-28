import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

// Preserve raw paths for boundary probes without URL path normalization.
export async function rawOwnedRequest(target, baseURL, path) {
  const origin = new URL(baseURL)
  if (!Object.values(target.origins).includes(origin.origin))
    throw new Error('Foreign raw request target')
  const request = origin.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: origin.hostname,
        servername: origin.hostname,
        port: origin.port,
        ca: target.caFile ? readFileSync(target.caFile) : undefined,
        family: 4,
        lookup: (_hostname, _options, callback) => callback(null, '127.0.0.1', 4),
        path,
        method: 'POST',
        headers: { origin: origin.origin },
      },
      (response) => {
        let body = ''
        response.on('data', (chunk) => {
          body += chunk
        })
        response.on('end', () => resolve({ status: response.statusCode, body }))
        response.on('error', () => reject(new Error('Raw response failed')))
      }
    )
    req.setTimeout(5000, () => req.destroy(new Error('Raw request timed out')))
    req.on('error', () => reject(new Error('Raw credential dispatch failed')))
    req.end()
  })
}
