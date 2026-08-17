import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { Input } from './input'
import { Label } from './label'

const meta = {
  title: 'shared/ui/Label',
  component: Label,
} satisfies Meta<typeof Label>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    children: 'Email',
    htmlFor: 'story-label-email',
  },
  render: (args) => (
    <div className="grid gap-2">
      <Label {...args} />
      <Input id="story-label-email" type="email" placeholder="email@example.com" />
    </div>
  ),
}

// `peer-disabled:` styling (baked into label.tsx's own className) — the
// label dims to match a disabled sibling input, rather than needing its
// own `disabled` prop.
export const WithDisabledField: Story = {
  render: () => (
    <div className="grid gap-2">
      <Label htmlFor="story-label-disabled">Email</Label>
      <Input
        id="story-label-disabled"
        type="email"
        disabled
        defaultValue="user@amcore.dev"
        className="peer"
      />
    </div>
  ),
}
