import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { Input } from './input'

const meta = {
  title: 'shared/ui/Input',
  component: Input,
  args: {
    placeholder: 'email@example.com',
  },
} satisfies Meta<typeof Input>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithValue: Story = {
  args: {
    defaultValue: 'user@amcore.dev',
  },
}

export const Disabled: Story = {
  args: {
    disabled: true,
    defaultValue: 'user@amcore.dev',
  },
}

// `aria-invalid` — the state `FormField`/`FormMessage` set together when a
// field fails validation (see `form.stories.tsx`'s `WithValidationError`).
export const Invalid: Story = {
  args: {
    'aria-invalid': true,
    defaultValue: 'not-an-email',
  },
}

// No placeholder (matches the real usage in
// features/auth-login/ui/LoginForm.tsx, which relies on FormLabel) —
// needs its own accessible name via aria-label instead, same as any bare
// Input used outside a Form/FormLabel pairing.
export const Password: Story = {
  args: {
    type: 'password',
    defaultValue: 'hunter2',
    placeholder: undefined,
    'aria-label': 'Password',
  },
}
