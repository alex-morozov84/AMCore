import type { OrganizationSetupState } from '@amcore/shared'
import { renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import { useSetupInventoryRefresh } from './use-setup-inventory-refresh'

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ refresh }),
}))
beforeEach(() => refresh.mockReset())
it('refreshes the inventory once after completion and keeps repeated status reads quiet', () => {
  const { rerender } = renderHook(
    ({ state }: { state?: OrganizationSetupState }) => useSetupInventoryRefresh(state),
    { initialProps: { state: 'eligible-empty' } }
  )
  rerender({ state: 'completed-intact' })
  rerender({ state: undefined })
  rerender({ state: 'completed-intact' })
  expect(refresh).toHaveBeenCalledTimes(1)
})
it('does not refresh an already completed page on load', () => {
  renderHook(() => useSetupInventoryRefresh('completed-intact'))
  expect(refresh).not.toHaveBeenCalled()
})
