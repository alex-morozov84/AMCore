import { ADMIN_CONSOLE_SETTINGS } from '@amcore/shared'
import { test } from '@playwright/test'

/** Declare Console prerequisites while collecting the enclosing suite. */
export function requirePathConsole() {
  test.skip(ADMIN_CONSOLE_SETTINGS.mode !== 'path', 'requires:path-console')
}

export function requireDisabledConsole() {
  test.skip(ADMIN_CONSOLE_SETTINGS.mode !== 'disabled', 'requires:disabled-console')
}
