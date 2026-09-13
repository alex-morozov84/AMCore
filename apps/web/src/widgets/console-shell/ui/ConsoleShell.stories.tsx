import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, waitFor } from 'storybook/test'

import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'

import { ConsoleShell } from './ConsoleShell'

const mutableConfig = ADMIN_CONSOLE_CONFIG as unknown as {
  mode: 'disabled' | 'path' | 'host'
}
const originalMode = ADMIN_CONSOLE_CONFIG.mode

const meta = {
  title: 'widgets/console-shell/ConsoleShell',
  component: ConsoleShell,
} satisfies Meta<typeof ConsoleShell>

export default meta
type Story = StoryObj<typeof meta>

export const Overview: Story = {
  args: {
    children: (
      <section
        aria-label="Console overview"
        className="border border-line-strong bg-surface-elevated p-6"
      >
        <p className="font-mono text-xs tracking-[0.2em] text-foreground-muted uppercase">
          Control Room
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Operations Console</h1>
        <p className="mt-3 text-foreground-muted">The control plane foundation is ready.</p>
      </section>
    ),
  },
}

export const Collapsed: Story = {
  ...Overview,
  play: async ({ canvasElement }) => {
    const trigger = canvasElement.querySelector<HTMLButtonElement>('[data-slot="sidebar-trigger"]')
    const title = canvasElement.querySelector('[data-console-shell="title"]')
    const footer = canvasElement.querySelector('[data-console-shell="footer"]')

    if (!trigger || !title || !footer) {
      throw new Error('Console shell collapse targets are missing.')
    }

    await userEvent.click(trigger)

    await waitFor(() => expect(title).not.toBeVisible())
    expect(footer).not.toBeVisible()
  },
}

export const HostMode: Story = {
  ...Overview,
  beforeEach: () => {
    mutableConfig.mode = 'host'
    return () => {
      mutableConfig.mode = originalMode
    }
  },
  play: async ({ canvasElement }) => {
    const overviewLink = canvasElement.querySelector('a[href="/en"]')

    expect(overviewLink).toBeInTheDocument()
  },
}
