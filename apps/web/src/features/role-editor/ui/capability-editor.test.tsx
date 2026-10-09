import { NextIntlClientProvider } from 'next-intl'
import type { CapabilityCatalogueResponse } from '@amcore/shared'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CapabilityEditor } from './capability-editor'

type Capability = CapabilityCatalogueResponse['capabilities'][number]
const messages = (await import(`../../../../messages/${DEFAULT_LOCALE}.json`)).default
const t = messages.organizationRoles

/** Ten areas of ten capabilities, none of which has copy: they render by id. */
const catalogue: Capability[] = Array.from({ length: 100 }, (_, index) => ({
  id: `area${Math.floor(index / 10)}.op${index}`,
  subject: `Area${Math.floor(index / 10)}`,
  action: 'read',
  operation: `op${index}`,
  method: 'GET',
  path: '/x',
  labelKey: `op${index}`,
  credentials: ['bearer'],
  presets: ['own', 'all'],
  editableFields: [],
})) as unknown as Capability[]

const view = (keys: string[] = [], onToggle = vi.fn()) =>
  render(
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
      <CapabilityEditor capabilities={catalogue} keys={keys} disabled={false} onToggle={onToggle} />
    </NextIntlClientProvider>
  )

describe('CapabilityEditor with a large catalogue', () => {
  it('collapses areas, opens the one with a configured level and counts them', () => {
    view(['area3.op35:own'])
    const areas = screen
      .getAllByText(/^\d+ of \d+ configured$/)
      .map((node) => node.closest('details')!)
    expect(areas).toHaveLength(10)
    expect(areas.filter((details) => details.open)).toHaveLength(1)
    expect(areas[3]!.open).toBe(true)
    expect(within(areas[3]!).getByText(new RegExp('^1 of 10'))).toBeInTheDocument()
  })

  it('searches across areas, opens every match and can be cleared', () => {
    view()
    fireEvent.change(screen.getByRole('textbox', { name: t.capabilitySearch }), {
      target: { value: 'op42' },
    })
    const matching = document.querySelectorAll('details[open]')
    expect(matching).toHaveLength(1)
    expect(matching[0]!.querySelectorAll('div[role="group"]')).toHaveLength(1)
    fireEvent.change(screen.getByRole('textbox', { name: t.capabilitySearch }), {
      target: { value: 'nothing-here' },
    })
    expect(screen.getByRole('status')).toHaveTextContent(t.noCapabilityMatches)
  })

  it('shows only configured capabilities on request', () => {
    view(['area1.op12:all', 'area7.op71:own'])
    fireEvent.click(screen.getByRole('checkbox', { name: t.onlyConfigured }))
    expect(document.querySelectorAll('details')).toHaveLength(2)
    expect(document.querySelectorAll('div[role="group"]')).toHaveLength(2)
  })

  it('still toggles a level through the same callback', () => {
    const onToggle = vi.fn()
    view(['area0.op0:own'], onToggle)
    const group = document.querySelector<HTMLElement>('div[role="group"]')!
    fireEvent.click(within(group).getByRole('checkbox', { name: 'All' }))
    expect(onToggle).toHaveBeenCalledWith('area0.op0', 'all')
  })
})

describe('CapabilityEditor with a small catalogue', () => {
  it('keeps the accepted flat layout: no search, no collapsing', () => {
    render(
      <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
        <CapabilityEditor
          capabilities={catalogue.slice(0, 4)}
          keys={[]}
          disabled={false}
          onToggle={vi.fn()}
        />
      </NextIntlClientProvider>
    )
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(document.querySelectorAll('details')).toHaveLength(0)
    expect(document.querySelectorAll('fieldset')).toHaveLength(1)
  })
})
