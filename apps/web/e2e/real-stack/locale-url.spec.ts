import { test } from '@playwright/test'

import { verifyLocaleUrl } from '../shared/locale-switcher-journey'

test('production locale navigation preserves query, event-time fragment and history', async ({
  page,
}) => {
  await verifyLocaleUrl(page)
})
