import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { Button } from '@/shared/ui/button'

import { contextAffordances } from './context-fixture'
import { useOrganizationContext } from './use-organization-context'

const binding = 'a'.repeat(64)
const probe = {
  events: [] as string[],
  held: false,
  changed: false,
  limited: '',
  release: () => {},
}
function TransitionProbe() {
  const [id, setId] = useState('A')
  const context = useOrganizationContext(binding, { kind: 'selected', id, locale: 'en' })
  return (
    <section aria-label="Lifecycle diagnostic" className="space-y-2">
      <output aria-label="Lifecycle status">
        {context.state.status}:{context.state.retryAt ? 'limited' : 'available'}
      </output>
      <Button
        onClick={() => {
          window.dispatchEvent(new Event('focus'))
          setId('B')
        }}
      >
        Resume and retarget
      </Button>
      <Button onClick={() => setId('C')}>Latest target</Button>
      <Button onClick={context.refresh}>Explicit retry</Button>
    </section>
  )
}
const meta = {
  title: 'entities/organization-context/TransitionProof',
  component: TransitionProbe,
  beforeEach({ msw }) {
    probe.events = []
    probe.held = false
    probe.changed = false
    probe.limited = ''
    msw.use(
      http.get('/api/product-access/bootstrap', async () => {
        probe.events.push('bootstrap')
        if (probe.held)
          await new Promise<void>((resolve) => {
            probe.release = resolve
          })
        return probe.limited === 'bootstrap'
          ? HttpResponse.json({}, { status: 429, headers: { 'Retry-After': '1' } })
          : HttpResponse.json({
              binding: probe.changed ? 'b'.repeat(64) : binding,
              actor: { id: 'actor', email: 'actor@example.test' },
            })
      }),
      http.get('/api/product-access/organizations/:id/context', ({ params }) => {
        probe.events.push(`domain:${params.id}`)
        return probe.limited === 'domain'
          ? HttpResponse.json({}, { status: 429, headers: { 'Retry-After': '1' } })
          : HttpResponse.json({
              binding,
              data: {
                organization: { id: params.id, name: 'Company', slug: 'company' },
                canManageTeamAccess: true,
                ...contextAffordances,
              },
            })
      })
    )
  },
} satisfies Meta<typeof TransitionProbe>
export default meta
type Story = StoryObj<typeof meta>

async function resumeProof(canvasElement: HTMLElement, changed: boolean) {
  const canvas = within(canvasElement)
  await waitFor(() => expect(canvas.getByLabelText('Lifecycle status')).toHaveTextContent('ready'))
  probe.events = []
  probe.held = true
  probe.changed = changed
  await userEvent.click(canvas.getByRole('button', { name: 'Resume and retarget' }))
  await userEvent.click(canvas.getByRole('button', { name: 'Latest target' }))
  await waitFor(() => expect(probe.events).toEqual(['bootstrap']))
  probe.release()
  await waitFor(() =>
    expect(canvas.getByLabelText('Lifecycle status')).toHaveTextContent(
      changed ? 'changed' : 'ready'
    )
  )
  await expect(probe.events).toEqual(changed ? ['bootstrap'] : ['bootstrap', 'domain:C'])
}
export const QueuedResume: Story = {
  play: ({ canvasElement }) => resumeProof(canvasElement, false),
}
export const ChangedBinding: Story = {
  play: ({ canvasElement }) => resumeProof(canvasElement, true),
}

async function cooldownProof(canvasElement: HTMLElement, leg: string) {
  const canvas = within(canvasElement)
  await waitFor(() => expect(canvas.getByLabelText('Lifecycle status')).toHaveTextContent('ready'))
  probe.limited = leg
  await userEvent.click(canvas.getByRole('button', { name: 'Explicit retry' }))
  await waitFor(() =>
    expect(canvas.getByLabelText('Lifecycle status')).toHaveTextContent('error:limited')
  )
  probe.events = []
  probe.limited = ''
  await userEvent.click(canvas.getByRole('button', { name: 'Latest target' }))
  await userEvent.click(canvas.getByRole('button', { name: 'Explicit retry' }))
  await waitFor(
    () => expect(canvas.getByLabelText('Lifecycle status')).toHaveTextContent('error:available'),
    { timeout: 2000 }
  )
  await expect(probe.events).toEqual([])
  await userEvent.click(canvas.getByRole('button', { name: 'Explicit retry' }))
  await waitFor(() => expect(canvas.getByLabelText('Lifecycle status')).toHaveTextContent('ready'))
  await expect(probe.events).toEqual(['bootstrap', 'domain:C'])
}
export const BootstrapCooldown: Story = {
  play: ({ canvasElement }) => cooldownProof(canvasElement, 'bootstrap'),
}
export const DomainCooldown: Story = {
  play: ({ canvasElement }) => cooldownProof(canvasElement, 'domain'),
}
