import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs'

describe('shared accessible tabs', () => {
  it('moves focus with arrows and activates a linked panel explicitly with Enter', async () => {
    const user = userEvent.setup()
    render(<Tabs defaultValue="first"><TabsList aria-label="Example choices">
      <TabsTrigger value="first">First</TabsTrigger><TabsTrigger value="second">Second</TabsTrigger>
    </TabsList><TabsContent value="first">First panel</TabsContent><TabsContent value="second">Second panel</TabsContent></Tabs>)
    const first = screen.getByRole('tab', { name: 'First' })
    const second = screen.getByRole('tab', { name: 'Second' })
    await user.tab()
    expect(first).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(second).toHaveFocus()
    expect(first).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')
    expect(second).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Second panel')
    expect(second).toHaveAttribute('aria-controls', screen.getByRole('tabpanel').id)
  })
  it('keeps the controlled selected panel visible when all actions are locked', async () => {
    const user = userEvent.setup()
    render(<Tabs value="first"><TabsList aria-label="Example choices">
      <TabsTrigger value="first" disabled>First</TabsTrigger><TabsTrigger value="second" disabled>Second</TabsTrigger>
    </TabsList><TabsContent value="first">Pending form</TabsContent><TabsContent value="second">Other form</TabsContent></Tabs>)
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Pending form')
    const second = screen.getByRole('tab', { name: 'Second' })
    expect(second).toHaveAttribute('aria-disabled', 'true')
    await user.click(second)
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Pending form')
  })
})
