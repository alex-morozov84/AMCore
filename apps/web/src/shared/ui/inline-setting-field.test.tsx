import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { InlineSettingField } from './inline-setting-field'

const props = {
  prefix: 'Check every',
  suffix: 'seconds',
  help: 'Choose an interval.',
  changed: false,
  saving: false,
  disabled: false,
  cancelDisabled: false,
  saveLabel: 'Save',
  savingLabel: 'Saving…',
  cancelLabel: 'Cancel',
  onCancel: vi.fn(),
}

describe('inline setting field presentation', () => {
  it('supports caller-owned numeric or text fields with nearby help', () => {
    const view = render(
      <InlineSettingField {...props}>
        <input aria-label="Interval" type="number" />
      </InlineSettingField>
    )
    expect(screen.getByRole('spinbutton', { name: 'Interval' })).toBeVisible()
    expect(screen.getByRole('button', { name: props.help })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    view.rerender(
      <InlineSettingField {...props} prefix="Name" suffix="" changed>
        <input aria-label="Name" />
      </InlineSettingField>
    )
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(props.onCancel).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'submit')
  })
  it('renders accessible loading feedback and blocks repeat actions', () => {
    render(
      <InlineSettingField {...props} changed saving disabled cancelDisabled>
        <input aria-label="Interval" />
      </InlineSettingField>
    )
    const save = screen.getByRole('button', { name: 'Saving…' })
    expect(save).toBeDisabled()
    expect(save).toHaveAttribute('aria-busy', 'true')
    expect(save.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })
})
