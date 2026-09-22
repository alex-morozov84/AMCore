import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { DropdownMenuItem } from './dropdown-menu'
import { RowActionsMenu } from './row-actions-menu'

describe('RowActionsMenu', () => {
  it('exposes only an accessible "Actions" trigger until opened', () => {
    render(
      <RowActionsMenu label="Actions">
        <DropdownMenuItem>Do something</DropdownMenuItem>
      </RowActionsMenu>
    )

    expect(screen.getByRole('button', { name: 'Actions' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
  })

  it('reveals its items on trigger click', async () => {
    const user = userEvent.setup()
    render(
      <RowActionsMenu label="Actions">
        <DropdownMenuItem>Do something</DropdownMenuItem>
      </RowActionsMenu>
    )

    await user.click(screen.getByRole('button', { name: 'Actions' }))

    expect(await screen.findByRole('menuitem', { name: 'Do something' })).toBeInTheDocument()
  })
})
