import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'

import { Button } from './button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './card'

const meta = {
  title: 'shared/ui/Card',
  component: Card,
} satisfies Meta<typeof Card>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('heading', { level: 2, name: 'Account settings' })
    ).toBeVisible()
  },
  render: () => (
    <Card className="w-80">
      <CardHeader>
        <CardTitle as="h2">Account settings</CardTitle>
        <CardDescription>Update your profile and preferences.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">Card content goes here.</p>
      </CardContent>
      <CardFooter>
        <Button size="sm">Save</Button>
      </CardFooter>
    </Card>
  ),
}

export const WithAction: Story = {
  render: () => (
    <Card className="w-80">
      <CardHeader>
        <CardTitle as="h2">Active sessions</CardTitle>
        <CardDescription>Devices currently signed in.</CardDescription>
        <CardAction>
          <Button size="sm" variant="outline">
            Revoke all
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">3 active sessions.</p>
      </CardContent>
    </Card>
  ),
}

// `as="h1"` — the card IS the page's primary content and nothing else
// provides a heading (the login/register card shape).
export const AsPageHeading: Story = {
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('heading', { level: 1, name: 'Sign in' })
    ).toBeVisible()
  },
  render: () => (
    <Card className="w-80">
      <CardHeader>
        <CardTitle as="h1">Sign in</CardTitle>
        <CardDescription>Welcome back to AMCore.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">Form fields would go here.</p>
      </CardContent>
    </Card>
  ),
}
