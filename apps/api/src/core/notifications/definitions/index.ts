import type { NotificationDefinition } from '../notification-definition.types'

import { accountProfileUpdatedDefinition } from './account-profile-updated.definition'

/**
 * The starter notification definitions registered at bootstrap. Forks add their
 * own here; the registry rejects duplicate types. Definitions with external/mandatory
 * channels (e.g. `account.password_changed` → in-app + email) land in Arc B with the
 * email adapter.
 */
export const NOTIFICATION_DEFINITIONS: readonly NotificationDefinition[] = [
  accountProfileUpdatedDefinition,
]
