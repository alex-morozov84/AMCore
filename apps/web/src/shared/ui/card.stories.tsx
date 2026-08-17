import type { Meta, StoryObj } from '@storybook/nextjs-vite'

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
  render: () => (
    <Card className="w-80">
      <CardHeader>
        <CardTitle>Account settings</CardTitle>
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
        <CardTitle>Active sessions</CardTitle>
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
// provides a heading (the login/register card shape). See card.tsx's
// CardTitle doc comment for the axe `page-has-heading-one` reasoning.
export const AsPageHeading: Story = {
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
