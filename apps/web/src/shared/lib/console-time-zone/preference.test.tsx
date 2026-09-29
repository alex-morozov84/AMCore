import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConsoleTimeZoneProvider, useConsoleTimeZone } from './index'
import { CONSOLE_TIME_ZONE_KEY, writeConsoleTimeZone } from './preference'

vi.mock('client-only', () => ({}))
afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

function Consumer() {
  const { mode } = useConsoleTimeZone()
  return <output>{mode}</output>
}
function tree() {
  return (
    <ConsoleTimeZoneProvider>
      <Consumer />
    </ConsoleTimeZoneProvider>
  )
}

describe('Console time-zone preference', () => {
  it('updates all consumers for same-tab, external changes, remove and clear', () => {
    render(
      <ConsoleTimeZoneProvider>
        <Consumer />
        <Consumer />
      </ConsoleTimeZoneProvider>
    )
    act(() => writeConsoleTimeZone('local'))
    expect(screen.getAllByText('local')).toHaveLength(2)
    act(() => {
      localStorage.removeItem(CONSOLE_TIME_ZONE_KEY)
      window.dispatchEvent(new StorageEvent('storage', { key: CONSOLE_TIME_ZONE_KEY }))
    })
    expect(screen.getAllByText('utc')).toHaveLength(2)
    act(() => {
      localStorage.setItem(CONSOLE_TIME_ZONE_KEY, 'local')
      window.dispatchEvent(new StorageEvent('storage', { key: CONSOLE_TIME_ZONE_KEY }))
    })
    expect(screen.getAllByText('local')).toHaveLength(2)
    act(() => {
      localStorage.clear()
      window.dispatchEvent(new StorageEvent('storage', { key: null }))
    })
    expect(screen.getAllByText('utc')).toHaveLength(2)
  })

  it('falls back to UTC for invalid or unavailable storage and outside Console', () => {
    localStorage.setItem(CONSOLE_TIME_ZONE_KEY, 'unknown')
    render(tree())
    expect(screen.getByText('utc')).toBeInTheDocument()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    act(() => writeConsoleTimeZone('local'))
    expect(screen.getByText('utc')).toBeInTheDocument()
    render(<Consumer />)
    expect(screen.getAllByText('utc')).toHaveLength(2)
  })

  it('hydrates each consumer with UTC before applying persisted local mode', async () => {
    localStorage.setItem(CONSOLE_TIME_ZONE_KEY, 'local')
    const errors = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    container.innerHTML = renderToString(tree())
    expect(container.textContent).toBe('utc')
    let root!: ReturnType<typeof hydrateRoot>
    await act(async () => {
      root = hydrateRoot(container, tree(), { onRecoverableError: errors })
    })
    expect(container.textContent).toBe('local')
    expect(errors).not.toHaveBeenCalled()
    act(() => root.unmount())
    container.remove()
  })
})
