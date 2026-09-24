import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const refresh = vi.fn()
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ refresh }),
}))

import { AuditResultRegion } from './AuditResultRegion'

describe('AuditResultRegion', () => {
  it('hides history rows synchronously until a new read token arrives', async () => {
    const view = (readToken: string) => (
      <AuditResultRegion readToken={readToken} loading="Loading audit">
        <p>Private audit row</p>
      </AuditResultRegion>
    )
    const { rerender } = render(view('read-a'))
    expect(screen.getByText('Private audit row')).toBeVisible()

    fireEvent.popState(window)
    expect(screen.getByText('Private audit row').closest('section')).toHaveAttribute('hidden')
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))

    rerender(view('read-b'))
    expect(screen.getByText('Private audit row')).toBeVisible()
    rerender(view('read-a'))
    expect(screen.getByText('Private audit row').closest('section')).toHaveAttribute('hidden')
  })
})
