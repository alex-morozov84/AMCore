import { readFileSync } from 'node:fs'
import path from 'node:path'

interface BuildIdentity {
  id: string | null
  version: string | null
  commit: string | null
}

/** Build output, never a runtime environment declaration or production attestation. */
export function readBuildIdentity(): BuildIdentity {
  try {
    const data = JSON.parse(readFileSync(path.join(__dirname, '../build-identity.json'), 'utf8'))
    if (!/^[a-f0-9]{64}$/.test(data.id) || !/^[A-Za-z0-9._+-]{1,128}$/.test(data.version)) {
      throw new Error('Invalid build identity')
    }
    return {
      id: data.id,
      version: data.version,
      commit:
        typeof data.commit === 'string' && /^[a-f0-9]{40,64}$/.test(data.commit)
          ? data.commit
          : null,
    }
  } catch {
    // Watch-mode/test code has not produced a deployable artifact.
    return { id: null, version: null, commit: null }
  }
}
