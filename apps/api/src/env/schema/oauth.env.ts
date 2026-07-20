import { z } from 'zod'

import { optionalEnvString, optionalEnvUrl } from './helpers'

// OAuth login providers. Each provider is optional, but the composed cross-field
// refinement enforces "configure one field of a provider → configure them all".
export const oauthEnv = z.object({
  GOOGLE_CLIENT_ID: optionalEnvString(),
  GOOGLE_CLIENT_SECRET: optionalEnvString(),
  GOOGLE_CALLBACK_URL: optionalEnvUrl(),
  GITHUB_CLIENT_ID: optionalEnvString(),
  GITHUB_CLIENT_SECRET: optionalEnvString(),
  GITHUB_CALLBACK_URL: optionalEnvUrl(),
  APPLE_CLIENT_ID: optionalEnvString(),
  APPLE_TEAM_ID: optionalEnvString(),
  APPLE_KEY_ID: optionalEnvString(),
  APPLE_PRIVATE_KEY: optionalEnvString(),
  APPLE_CALLBACK_URL: optionalEnvUrl(),
})
