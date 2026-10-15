import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { userKeys } from '@/entities/user'
import { authApi } from '@/shared/api'
import { ApiRequestError } from '@/shared/api/http-client'

import { AvatarEditor } from './AvatarEditor'

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => {
    const t = (key: string) => `${namespace}.${key}`
    t.has = () => true
    return t
  },
}))
vi.mock('@/shared/api', () => ({
  authApi: { getMe: vi.fn(), uploadAvatar: vi.fn(), deleteAvatar: vi.fn() },
}))

function renderEditor(avatarUrl: string | null = null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(userKeys.me(), {
    user: { id: 'u1', email: 'a@example.test', name: 'Ada Lovelace', avatarUrl },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <AvatarEditor />
    </QueryClientProvider>
  )
}

const photo = (size = 10, type = 'image/png') => new File([new Uint8Array(size)], 'a.png', { type })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authApi.getMe).mockResolvedValue({ user: null } as never)
})

describe('AvatarEditor', () => {
  it('offers to choose a photo when there is none and hides Remove', () => {
    renderEditor()
    expect(screen.getByRole('button', { name: 'account.avatar.choose' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'account.avatar.remove' })).toBeNull()
    expect(screen.getByText('AL')).toBeInTheDocument()
  })

  it('uploads the chosen file, announces it and shows the new photo', async () => {
    vi.mocked(authApi.uploadAvatar).mockResolvedValue({ avatarUrl: 'https://f.test/new.webp' })
    renderEditor()
    await userEvent.upload(screen.getByLabelText('account.avatar.photoLabel'), photo())
    expect(await screen.findByText('account.avatar.uploaded')).toBeInTheDocument()
    expect(authApi.uploadAvatar).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://f.test/new.webp')
    expect(screen.getByRole('button', { name: 'account.avatar.change' })).toBeInTheDocument()
  })

  it('refuses an oversized photo with a message and no request', async () => {
    renderEditor()
    await userEvent.upload(
      screen.getByLabelText('account.avatar.photoLabel'),
      photo(2 * 1024 * 1024 + 1)
    )
    expect(await screen.findByText('account.avatar.tooLarge')).toBeInTheDocument()
    expect(authApi.uploadAvatar).not.toHaveBeenCalled()
  })

  it('shows the busy message when the server reports a locked avatar', async () => {
    vi.mocked(authApi.uploadAvatar).mockRejectedValue(new ApiRequestError(503, undefined))
    renderEditor()
    await userEvent.upload(screen.getByLabelText('account.avatar.photoLabel'), photo())
    expect(await screen.findByText('account.avatar.busy')).toBeInTheDocument()
  })

  it('shows the unknown message when the request outcome cannot be confirmed', async () => {
    vi.mocked(authApi.uploadAvatar).mockRejectedValue(new ApiRequestError(500, undefined))
    renderEditor()
    await userEvent.upload(screen.getByLabelText('account.avatar.photoLabel'), photo())
    expect(await screen.findByText('account.avatar.unknown')).toBeInTheDocument()
  })

  it('removes the photo only after the confirmation', async () => {
    vi.mocked(authApi.deleteAvatar).mockResolvedValue(undefined)
    renderEditor('https://f.test/old.webp')
    await userEvent.click(screen.getByRole('button', { name: 'account.avatar.remove' }))
    expect(authApi.deleteAvatar).not.toHaveBeenCalled()
    await userEvent.click(
      await screen.findByRole('button', { name: 'account.avatar.removeConfirm' })
    )
    await waitFor(() => expect(authApi.deleteAvatar).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('account.avatar.removed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'account.avatar.remove' })).toBeNull()
  })
})
