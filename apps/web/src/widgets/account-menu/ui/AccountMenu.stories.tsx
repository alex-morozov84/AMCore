import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { userKeys } from '@/entities/user'

import { AccountMenu } from './AccountMenu'

function withUser(user: { name: string | null; avatarUrl: string | null }) {
  return function Decorator(Story: () => React.ReactElement) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(userKeys.me(), {
      user: { id: 'story-user', email: 'ada@example.com', ...user },
    })
    return (
      <QueryClientProvider client={queryClient}>
        <div className="flex min-h-72 justify-end p-4">
          <Story />
        </div>
      </QueryClientProvider>
    )
  }
}

const meta = {
  title: 'widgets/account-menu/AccountMenu',
  component: AccountMenu,
} satisfies Meta<typeof AccountMenu>

export default meta
type Story = StoryObj<typeof meta>

// The open-menu state is covered by AccountMenu.test.tsx and the real-stack axe scan (Base UI's
// focus-guard sentinels trip the Storybook a11y gate only in this isolated render).
export const Closed: Story = {
  decorators: [withUser({ name: 'Ada Lovelace', avatarUrl: null })],
}

export const WithoutName: Story = {
  decorators: [withUser({ name: null, avatarUrl: null })],
}

export const ProfileOpen: Story = {
  decorators: [withUser({ name: 'Ada Lovelace', avatarUrl: null })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Account menu' }))
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: /Profile/ }))
    const dialog = await within(document.body).findByRole('dialog')
    await waitFor(() => expect(dialog).toBeVisible())
  },
}

export const Loading: Story = {
  decorators: [
    (Story) => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      queryClient.setQueryDefaults(userKeys.me(), { queryFn: () => new Promise(() => {}) })
      return (
        <QueryClientProvider client={queryClient}>
          <div className="flex min-h-72 justify-end p-4">
            <Story />
          </div>
        </QueryClientProvider>
      )
    },
  ],
}
