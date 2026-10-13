import recommended from './react-recommended.json' with { type: 'json' }
import accessibility from './accessibility-recommended.json' with { type: 'json' }
import noDeprecated from './react-deprecated.js'

// Preserve the previously enabled policy without installing unsupported peers.
export const reactPolicy = {
  configs: { recommended: { rules: recommended } },
  rules: { 'no-deprecated': noDeprecated },
}
export const accessibilityPolicy = { configs: { recommended: { rules: accessibility } } }
