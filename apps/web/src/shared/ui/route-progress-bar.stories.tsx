import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, waitFor, within } from 'storybook/test'

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

// No InteractionCycle story here (removed 2026-09-10, reconverged FINAL
// PLAN item 5): it used to prove a real `<Link>` click reached the bar's
// own document-level click listener. That listener is gone -- Link clicks
// now start the bar via `RouteProgressLink`'s `onNavigate` (see
// route-progress-link.tsx) -- and `@storybook/nextjs-vite`'s `next/link`
// mock does not implement `onNavigate` at all (confirmed: it renders a
// plain `<a>` and React warns "Unknown event handler property
// `onNavigate`"), so no story in this environment can exercise it. The
// same coverage now lives in route-progress-link.test.tsx (unit, a
// controlled mock that does call `onNavigate`) and
// e2e/mocked/route-progress-bar.spec.ts (a real `<Link>` click against the
// real `next dev` server, where `onNavigate` genuinely fires).
