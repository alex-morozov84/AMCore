import { createRequire } from 'node:module'
import path from 'node:path'

/** Oxlint settings are global. Reject conflicting scoped settings explicitly. */
export function nativeSettings(policy, cwd) {
  const settings = {}
  for (const block of policy) {
    for (const name of ['react', 'jsx-a11y', 'next']) {
      if (!block.settings?.[name]) continue
      const value = { ...block.settings[name] }
      if (name === 'react' && value.version === 'detect') {
        value.version = createRequire(path.join(cwd, 'package.json'))('react/package.json').version
      }
      if (settings[name] && JSON.stringify(settings[name]) !== JSON.stringify(value)) {
        throw new Error(`Oxlint cannot represent conflicting scoped ${name} settings`)
      }
      settings[name] = value
    }
  }
  return settings
}
