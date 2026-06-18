import type { NotificationDefinition } from '../notification-definition.types'

import { accountPasswordChangedDefinition } from './account-password-changed.definition'
import { accountProfileUpdatedDefinition } from './account-profile-updated.definition'

/**
 * The starter notification definitions registered at bootstrap. Forks add their
 * own here; the registry rejects duplicate types. `account.password_changed` is the
 * first definition with an external (email) channel and mandatory deliveries — the
 * dispatcher (Arc B) drains its email delivery via the worker-only adapter.
 */
export const NOTIFICATION_DEFINITIONS: readonly NotificationDefinition[] = [
  accountProfileUpdatedDefinition,
  accountPasswordChangedDefinition,
]
