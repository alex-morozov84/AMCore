import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from './dialog'

describe('Dialog', () => {
  it('opens on trigger click and shows its content', async () => {
    const user = userEvent.setup()

    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent closeLabel="Close">
          <DialogTitle>Confirm</DialogTitle>
          <DialogDescription>Are you sure?</DialogDescription>
        </DialogContent>
      </Dialog>
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /open/i }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Confirm')).toBeInTheDocument()
    expect(screen.getByText('Are you sure?')).toBeInTheDocument()
  })

  it('closes when the built-in close button is clicked', async () => {
    const user = userEvent.setup()

    render(
      <Dialog defaultOpen>
        <DialogContent closeLabel="Close">
          <DialogTitle>Confirm</DialogTitle>
        </DialogContent>
      </Dialog>
    )

    expect(await screen.findByRole('dialog')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /close/i }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('omits the close button when showCloseButton is false', async () => {
    render(
      <Dialog defaultOpen>
        <DialogContent showCloseButton={false}>
          <DialogTitle>Confirm</DialogTitle>
        </DialogContent>
      </Dialog>
    )

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument()
  })
})
