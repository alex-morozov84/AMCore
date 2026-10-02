import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, within } from 'storybook/test'

import { StorageProbeIntervalEditor } from './StorageProbeIntervalEditor'

const baseline = {
  saved: { intervalSeconds: null, revision: 0 },
  baselineSeconds: 600,
  applied: {
    intervalSeconds: 600,
    revision: 0,
    source: 'baseline',
    refreshStatus: 'confirmed',
    lastConfirmedAt: '2026-10-02T00:00:00.000Z',
    nextScheduledAt: null,
  },
}
const route = '/api/console/runtime-settings/storage-probe'
const meta = {
  title: 'features/console-storage-setting/Overview interval editor',
  component: StorageProbeIntervalEditor,
  args: { observedInterval: 600 },
  parameters: { msw: { handlers: [http.get(route, () => HttpResponse.json(baseline))] } },
} satisfies Meta<typeof StorageProbeIntervalEditor>
export default meta
type Story = StoryObj<typeof meta>
export const Unchanged: Story = {}
export const EditAndCancel: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = await canvas.findByRole('spinbutton')
    await userEvent.clear(input)
    await userEvent.type(input, '90')
    await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }))
    expect(input).toHaveFocus()
    expect(input).toHaveValue(600)
    expect(canvas.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  },
}
export const ReadUnavailable: Story = {
  parameters: {
    msw: { handlers: [http.get(route, () => HttpResponse.json({}, { status: 503 }))] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/Storage status is still available/)).toBeVisible()
  },
}
export const SavedAwaitingApplication: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(route, () =>
          HttpResponse.json({
            ...baseline,
            saved: { intervalSeconds: 90, revision: 1 },
          })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByRole('spinbutton')).toHaveValue(90)
    expect(canvas.getByText(/The new interval will take effect shortly/)).toBeVisible()
  },
}

export const Saving: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(route, () => HttpResponse.json(baseline)),
        http.patch(route, async () => {
          await new Promise((resolve) => setTimeout(resolve, 5000))
          return HttpResponse.json(baseline)
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = await canvas.findByRole('spinbutton')
    await userEvent.clear(input)
    await userEvent.type(input, '90')
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    expect(await canvas.findByRole('button', { name: /Saving/ })).toBeDisabled()
    expect(canvas.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  },
}
