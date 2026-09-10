import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fireEvent, waitFor, within } from 'storybook/test'

import { Link } from '@/i18n/navigation'
import { createRouteProgressController } from '@/shared/lib/route-progress/route-progress-controller'

import { RouteProgressBar } from './route-progress-bar'

const meta = {
  title: 'shared/ui/RouteProgressBar',
  component: RouteProgressBar,
  // Every story gets its own controller instance -- the default export
  // wraps the real app-wide singleton, which would let these stories
  // interfere with each other and with any other test importing it.
} satisfies Meta<typeof RouteProgressBar>

export default meta
type Story = StoryObj<typeof meta>

export const Idle: Story = {
  args: { controller: createRouteProgressController() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByTestId('route-progress-bar')).toBeNull()
  },
}

// A near-zero reveal delay is a Storybook-only visualization convenience --
// the real app's default (~120ms) is covered by route-progress-bar.test.tsx
// and route-progress-controller.test.ts, not by demonstrating it here.
export const Visible: Story = {
  args: { controller: createRouteProgressController({ revealDelayMs: 0 }) },
  play: async ({ args, canvasElement }) => {
    args.controller!.start()
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId('route-progress-bar')).toBeInTheDocument())
    await expect(canvas.getByTestId('route-progress-bar')).toHaveAttribute('data-phase', 'visible')
  },
}

export const Completing: Story = {
  args: {
    controller: createRouteProgressController({ revealDelayMs: 0, completingMs: 4000 }),
  },
  play: async ({ args, canvasElement }) => {
    const { controller } = args
    controller!.start()
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId('route-progress-bar')).toBeInTheDocument())
    controller!.finish()
    await waitFor(() =>
      expect(canvas.getByTestId('route-progress-bar')).toHaveAttribute('data-phase', 'completing')
    )
  },
}

// Proves the document-level listener genuinely detects a real `<Link>`
// click, not just a plain `<a>` (route-progress-bar.test.tsx's jsdom suite
// covers plain anchors and the qualifying-click filters in isolation).
// This is exactly the case that caught a real bug during implementation:
// Link's own onClick always calls preventDefault() as part of normal
// client-side routing, which an earlier version of isQualifyingLinkClick
// mistook for "this click was cancelled" and ignored every real Link click
// -- see that function's doc comment. Stops at "becomes visible": Storybook
// has no real App Router to commit a navigation and change usePathname(),
// so finish() has nothing to react to here -- the full click-to-idle
// lifecycle against a real, running app is Playwright e2e's job (FINAL PLAN
// acceptance contract item 3), not this isolated render. fireEvent
// dispatches an untrusted click, which a browser never runs the default
// action for, so the anchor's href is never actually followed.
export const InteractionCycle: Story = {
  args: {
    controller: createRouteProgressController({ revealDelayMs: 0 }),
  },
  render: (args) => (
    <>
      <Link href="/storybook-target">Navigate</Link>
      <RouteProgressBar {...args} />
    </>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const link = canvas.getByRole('link', { name: 'Navigate' })
    fireEvent.click(link, { button: 0 })
    await waitFor(() =>
      expect(canvas.getByTestId('route-progress-bar')).toHaveAttribute('data-phase', 'visible')
    )
  },
}
