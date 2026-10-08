import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { AlertCircle, Terminal } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from './alert'

const meta = {
  title: 'shared/ui/Alert',
  component: Alert,
} satisfies Meta<typeof Alert>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Alert className="w-96">
      <Terminal />
      <AlertTitle>Heads up</AlertTitle>
      <AlertDescription>You can add components to your app.</AlertDescription>
    </Alert>
  ),
}

// Colour lives in the border, tinted surface and icon; the text keeps the normal foreground colour
// because red text on a red tint measured below the 4.5:1 WCAG AA minimum — see alert.tsx.
export const Destructive: Story = {
  render: () => (
    <Alert variant="destructive" className="w-96">
      <AlertCircle />
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>Your session has expired. Please sign in again.</AlertDescription>
    </Alert>
  ),
}

// Something to notice but not a failure: a conflict, an unknown result, pending impact.
export const Warning: Story = {
  render: () => (
    <Alert variant="warning" className="w-96">
      <AlertCircle />
      <AlertTitle>Review needed</AlertTitle>
      <AlertDescription>This role was changed somewhere else.</AlertDescription>
    </Alert>
  ),
}

// A standing, non-urgent note: `role="note"` replaces the default assertive `role="alert"` (props are
// spread after it), and `line-clamp-none` lets a long title wrap instead of being clipped at one line.
export const InformationalNote: Story = {
  render: () => (
    <Alert role="note" className="w-80">
      <Terminal aria-hidden />
      <AlertTitle className="line-clamp-none">
        A long title that must wrap on a narrow screen instead of being cut off
      </AlertTitle>
      <AlertDescription>
        Calm, permanent information that is not announced as an alert.
      </AlertDescription>
    </Alert>
  ),
}
