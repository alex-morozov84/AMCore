import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './alert-dialog'

describe('AlertDialog', () => {
  it('opens on trigger click and shows its content', async () => {
    const user = userEvent.setup()

    render(
      <AlertDialog>
        <AlertDialogTrigger>Delete</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>Delete item?</AlertDialogTitle>
          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction>Confirm</AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>
    )

    await user.click(screen.getByRole('button', { name: /delete/i }))

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText('Delete item?')).toBeInTheDocument()
  })

  it('calls the action handler and closes on cancel', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()

    render(
      <AlertDialog defaultOpen>
        <AlertDialogContent>
          <AlertDialogTitle>Delete item?</AlertDialogTitle>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Confirm</AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>
    )

    await user.click(await screen.findByRole('button', { name: /confirm/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: /cancel/i }))

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
  })
})
