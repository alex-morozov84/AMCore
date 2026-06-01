import type { MediaPreset, MediaPresetName } from '../media.types'

import { AVATAR_DERIVATIVES, AVATAR_SOURCE_POLICY } from './avatar.preset'

/**
 * Registry of named presets the `MediaService` can produce. A preset bundles the
 * derivative set, the source acceptance policy, and the object-key namespace.
 * New media features add an entry here (and a `MediaPresetName` member).
 */
export const MEDIA_PRESETS: Record<MediaPresetName, MediaPreset> = {
  avatar: {
    name: 'avatar',
    keyspace: 'avatars',
    derivatives: AVATAR_DERIVATIVES,
    sourcePolicy: AVATAR_SOURCE_POLICY,
  },
}
