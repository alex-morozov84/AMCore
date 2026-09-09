import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'

import { SectionErrorBoundary } from './section-error-boundary'

const meta = {
  title: 'shared/ui/SectionErrorBoundary',
  component: SectionErrorBoundary,
} satisfies Meta<typeof SectionErrorBoundary>

export default meta
type Story = StoryObj<typeof meta>

let shouldThrow = true

class ClassifiedStoryError extends Error {
  override name = 'raw-name-token'
  digest = 'raw-digest-token'
  classification = 'raw-classification-token'
}

function RecoverableChild() {
  if (shouldThrow) throw new ClassifiedStoryError('raw-message-token')
  return <div>Recovered section content</div>
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
  args: { children: <RecoverableChild /> },
  beforeEach: () => {
    shouldThrow = true
  },
  render: ({ children }) => (
    <div>
      <div>Sibling section</div>
      <SectionErrorBoundary>{children}</SectionErrorBoundary>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Something went wrong')).toBeInTheDocument()
    await expect(canvas.getByText('Sibling section')).toBeInTheDocument()
    expect(canvasElement.innerHTML).not.toMatch(/raw-(?:message|name|digest|classification)-token/)

    shouldThrow = false
    await userEvent.click(canvas.getByRole('button', { name: 'Retry' }))

    await expect(await canvas.findByText('Recovered section content')).toBeInTheDocument()
    await expect(canvas.getByText('Sibling section')).toBeInTheDocument()
  },
}
