import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'

import { SectionErrorBoundary } from './section-error-boundary'

const meta = {
  title: 'shared/ui/SectionErrorBoundary',
  component: SectionErrorBoundary,
} satisfies Meta<typeof SectionErrorBoundary>

export default meta
type Story = StoryObj<typeof meta>

function ThrowingChild(): never {
  throw new Error('a genuine bug in this section - never shown to the user')
}

// `.storybook/preview.tsx`'s global `parameters.nextjs.appDirectory` mock
// supplies the Next app-router client runtime `catchError` needs - plain
// Vitest/Testing Library does not have it (see
// section-error-boundary.test.tsx), which is why this behavior is proven
// here instead.

export const Healthy: Story = {
  args: { children: <div>Real section content</div> },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Real section content')).toBeInTheDocument()
  },
}

export const UnexpectedException: Story = {
  args: { children: <ThrowingChild /> },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Something went wrong')).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    // The generic starter never shows the real thrown message to the user.
    expect(canvas.queryByText(/a genuine bug in this section/)).not.toBeInTheDocument()
  },
}
