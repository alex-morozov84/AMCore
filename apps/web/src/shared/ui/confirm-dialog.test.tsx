import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Button } from './button'
import { ConfirmDialog, type ConfirmDialogProps } from './confirm-dialog'

function Harness(props: Omit<ConfirmDialogProps, 'open' | 'onOpenChange'>) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Delete</Button>
      <ConfirmDialog open={open} onOpenChange={setOpen} {...props} />
    </>
  )
}

const baseProps = {
  title: 'Delete item?',
  description: 'This cannot be undone.',
  confirmLabel: 'Delete',
  cancelLabel: 'Cancel',
}

describe('ConfirmDialog', () => {
  it('is closed until its controller sets `open`', async () => {
    const user = userEvent.setup()
    render(<Harness {...baseProps} onConfirm={vi.fn()} />)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument()
  })

  it('closes without calling onConfirm when cancelled', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<Harness {...baseProps} onConfirm={onConfirm} />)
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('closes itself and calls onConfirm when confirmed', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<Harness {...baseProps} onConfirm={onConfirm} />)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = within(screen.getByRole('alertdialog'))

    await user.click(dialog.getByRole('button', { name: 'Delete' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('disables the confirm button when disabled', async () => {
    const user = userEvent.setup()
    render(<Harness {...baseProps} onConfirm={vi.fn()} disabled />)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = within(screen.getByRole('alertdialog'))

    expect(dialog.getByRole('button', { name: 'Delete' })).toBeDisabled()
  })
})
