import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { userKeys } from '@/entities/user'

import { AvatarEditor } from './AvatarEditor'

const photo =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="%23888"/></svg>'

function withUser(avatarUrl: string | null) {
  return function Decorator(Story: () => React.ReactElement) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(userKeys.me(), {
      user: { id: 'story-user', email: 'ada@example.com', name: 'Ada Lovelace', avatarUrl },
    })
    return (
      <QueryClientProvider client={queryClient}>
        <div className="w-96 p-4">
          <Story />
        </div>
      </QueryClientProvider>
    )
  }
}

const meta = {
  title: 'features/avatar-edit/AvatarEditor',
  component: AvatarEditor,
} satisfies Meta<typeof AvatarEditor>

export default meta
type Story = StoryObj<typeof meta>

export const WithoutPhoto: Story = { decorators: [withUser(null)] }

export const WithPhoto: Story = { decorators: [withUser(photo)] }
