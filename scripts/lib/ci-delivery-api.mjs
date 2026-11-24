import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function readProofArchive(buffer) {
  if (buffer.byteLength > 65_536) throw new Error('PR artifact exceeds size limit')
  const directory = mkdtempSync(join(tmpdir(), 'ci-pr-proof-'))
  try {
    const archive = join(directory, 'proof.zip')
    writeFileSync(archive, buffer)
    const member = execFileSync('unzip', ['-Z1', archive], {
      encoding: 'utf8',
      maxBuffer: 1024,
    }).trim()
    if (member !== 'ci-pr-proof.json') throw new Error('Unexpected PR artifact inventory')
    return JSON.parse(
      execFileSync('unzip', ['-p', archive, member], { encoding: 'utf8', maxBuffer: 65_536 })
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

export function githubEvidence(env, repository) {
  const base = env.GITHUB_API_URL
  if (!base || !env.CI_EVIDENCE_TOKEN || !/^[\w.-]+\/[\w.-]+$/.test(repository)) return undefined
  return async (path, archive = false) => {
    const signal = globalThis.AbortSignal.timeout(8000)
    const response = await fetch(`${base}/repos/${repository}${path ? `/${path}` : ''}`, {
      signal,
      redirect: archive ? 'manual' : 'error',
      headers: {
        Authorization: `Bearer ${env.CI_EVIDENCE_TOKEN}`,
        Accept: 'application/vnd.github+json',
      },
    })
    if (!archive) {
      if (!response.ok) throw new Error('GitHub evidence unavailable')
      return response.json()
    }
    const destination = new URL(response.headers.get('location') ?? 'invalid')
    if (response.status !== 302 || destination.protocol !== 'https:')
      throw new Error('GitHub did not supply a secure artifact URL')
    const download = await fetch(destination, { signal, redirect: 'error' })
    if (!download.ok || Number(download.headers.get('content-length')) > 65_536)
      throw new Error('GitHub artifact unavailable')
    return readProofArchive(Buffer.from(await download.arrayBuffer()))
  }
}
