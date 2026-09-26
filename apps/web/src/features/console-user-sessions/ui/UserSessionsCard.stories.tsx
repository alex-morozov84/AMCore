import type { AdminSession } from '@amcore/shared'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { UserSessionsCard } from './UserSessionsCard'

const USER_ID = 'user-123'
const SESSIONS_URL = `/api/console/users/${USER_ID}/sessions`

const IPHONE_SESSION: AdminSession = {
  sessionId: 'family-iphone',
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipAddress: '1.1.1.1',
  location: { city: 'Sydney', countryCode: 'AU' },
  lastAuthAt: '2026-09-26T14:14:30.960Z',
  createdAt: '2026-09-26T14:14:30.960Z',
  expiresAt: '2026-10-03T14:14:30.960Z',
}

const WINDOWS_SESSION: AdminSession = {
  sessionId: 'family-windows',
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  ipAddress: '192.168.1.10',
  location: null,
  lastAuthAt: '2026-09-26T14:14:30.923Z',
  createdAt: '2026-09-26T14:14:30.923Z',
  expiresAt: '2026-10-03T14:14:30.923Z',
}

function sessionsResponse(data: AdminSession[]) {
  return HttpResponse.json({ data, total: data.length, page: 1, limit: 20 })
}

// The desktop table and the mobile card list are both mounted at once
// (swapped by CSS, not JS) — every row's text exists twice in the DOM, so a
// plain `getByText` is always ambiguous here. `[0]` is the desktop table's
// copy, the one actually visible at Storybook's default viewport width.
function firstMatch(canvas: ReturnType<typeof within>, text: string) {
  return canvas.getAllByText(text)[0]
}

const meta = {
  title: 'features/console-user-sessions/UserSessionsCard',
  component: UserSessionsCard,
  args: {
    userId: USER_ID,
    targetEmail: 'target@example.test',
    isSelf: false,
  },
} satisfies Meta<typeof UserSessionsCard>

export default meta
type Story = StoryObj<typeof meta>

export const Populated: Story = {
  beforeEach({ msw }) {
    msw.use(http.get(SESSIONS_URL, () => sessionsResponse([IPHONE_SESSION, WINDOWS_SESSION])))
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByText('Sessions (2 total)')).toBeInTheDocument())
    expect(firstMatch(canvas, 'Safari on iOS')).toBeInTheDocument()
    expect(canvas.getAllByText('Sydney, Australia')[0]).toBeInTheDocument()
    // The unresolved (private-range) session's location, not the raw userAgent, is the fallback.
    expect(canvas.getAllByText('Location unavailable')[0]).toBeInTheDocument()
  },
}

// Raw userAgent stays hidden behind its own disclosure — proves the
// column-stable table.table-fixed layout doesn't need it expanded to pass.
export const RawUserAgentDisclosure: Story = {
  beforeEach({ msw }) {
    msw.use(http.get(SESSIONS_URL, () => sessionsResponse([IPHONE_SESSION])))
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(firstMatch(canvas, 'Safari on iOS')).toBeInTheDocument())
    expect(canvas.queryByText(/AppleWebKit/)).not.toBeInTheDocument()

    await userEvent.click(canvas.getAllByRole('button', { name: /show raw details/i })[0])
    expect(await canvas.findByText(/AppleWebKit/)).toBeInTheDocument()
  },
}

export const Empty: Story = {
  beforeEach({ msw }) {
    msw.use(http.get(SESSIONS_URL, () => sessionsResponse([])))
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByText('No active sessions.')).toBeInTheDocument())
  },
}

export const ErrorState: Story = {
  beforeEach({ msw }) {
    msw.use(http.get(SESSIONS_URL, () => HttpResponse.json({ message: 'boom' }, { status: 500 })))
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // TanStack Query's default retry (3 attempts, exponential backoff) runs
    // before a query GET settles into `isError` — comfortably outlasts the
    // default `waitFor` timeout.
    await waitFor(
      () =>
        expect(
          canvas.getByText('This is temporarily unavailable. Please try again.')
        ).toBeInTheDocument(),
      { timeout: 10000 }
    )
  },
}

// The viewer's own detail page (ADR-047 boundary): no revoke-all, no
// per-row menu, a note pointing to Settings instead.
export const SelfView: Story = {
  args: { isSelf: true },
  beforeEach({ msw }) {
    msw.use(http.get(SESSIONS_URL, () => sessionsResponse([IPHONE_SESSION])))
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(firstMatch(canvas, 'Safari on iOS')).toBeInTheDocument())
    expect(canvas.queryByRole('button', { name: /revoke all sessions/i })).not.toBeInTheDocument()
  },
}

export const RevokeOne: Story = {
  beforeEach({ msw }) {
    let sessions = [IPHONE_SESSION, WINDOWS_SESSION]
    msw.use(
      http.get(SESSIONS_URL, () => sessionsResponse(sessions)),
      http.delete(`${SESSIONS_URL}/family-iphone`, () => {
        sessions = sessions.filter((session) => session.sessionId !== 'family-iphone')
        return new HttpResponse(null, { status: 204 })
      })
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByText('Sessions (2 total)')).toBeInTheDocument())

    await userEvent.click(canvas.getAllByRole('button', { name: /actions for session/i })[0])
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole('menuitem', { name: /revoke session/i }))
    await userEvent.click(await body.findByRole('button', { name: /revoke session/i }))

    await waitFor(() => expect(canvas.getByText('Sessions (1 total)')).toBeInTheDocument())
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Refresh' })).toHaveFocus())
  },
}

// A response remains pending until the interaction explicitly releases it.
// Each replay owns its requests; disposing an old run cannot release a new one.
function createPageResponses() {
  const requests: { page: number; released: boolean; release: () => void }[] = []
  let disposed = false
  return {
    requests,
    hold(page: number) {
      if (disposed) return Promise.resolve()
      return new Promise<void>((resolve) => {
        const request = {
          page,
          released: false,
          release() {
            request.released = true
            resolve()
          },
        }
        requests.push(request)
      })
    },
    dispose() {
      disposed = true
      requests.forEach((request) => request.release())
    },
  }
}

let activePageResponses: ReturnType<typeof createPageResponses> | undefined
const RESPONSE_WAIT = { timeout: 5000 }

export const IndependentPaginationAndRefresh: Story = {
  beforeEach({ msw }) {
    const responses = createPageResponses()
    activePageResponses = responses
    msw.use(
      http.get(SESSIONS_URL, async ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page') ?? '1')
        if (page === 2) await responses.hold(page)
        const data =
          page === 1
            ? Array.from({ length: 20 }, (_, i) => ({
                ...IPHONE_SESSION,
                sessionId: `family-${i}`,
              }))
            : [WINDOWS_SESSION]
        return HttpResponse.json({ data, total: 21, page, limit: 20 })
      })
    )
    return () => {
      responses.dispose()
      if (activePageResponses === responses) activePageResponses = undefined
    }
  },
  play: async ({ canvasElement }) => {
    const responses = activePageResponses
    if (!responses) throw new Error('Pagination response fixture was not initialized')
    const canvas = within(canvasElement)
    const initialUrl = canvasElement.ownerDocument.location.href
    try {
      await waitFor(async () => {
        await expect(canvas.getByText('Sessions (21 total)')).toBeInTheDocument()
        await expect(canvas.getByRole('button', { name: 'Refresh' })).toBeEnabled()
        await expect(canvas.getByRole('button', { name: 'Next' })).toBeEnabled()
      }, RESPONSE_WAIT)
      await userEvent.click(canvas.getByRole('button', { name: 'Next' }))
      await waitFor(async () => {
        await expect(responses.requests).toHaveLength(1)
        await expect(responses.requests[0]).toMatchObject({ page: 2, released: false })
        await expect(canvas.getByRole('button', { name: 'Refresh' })).toBeDisabled()
        await expect(canvas.getByRole('button', { name: 'Previous' })).toBeDisabled()
        await expect(canvas.queryAllByText('Chrome on Windows')).toHaveLength(0)
      }, RESPONSE_WAIT)
      responses.requests[0].release()
      await waitFor(async () => {
        await expect(firstMatch(canvas, 'Chrome on Windows')).toBeInTheDocument()
        await expect(canvas.getByRole('button', { name: 'Refresh' })).toBeEnabled()
        await expect(canvas.getByRole('button', { name: 'Next' })).toBeDisabled()
        await expect(canvas.getByRole('button', { name: 'Previous' })).toBeEnabled()
      }, RESPONSE_WAIT)
      await expect(canvas.getByText('Sessions (21 total)')).toBeInTheDocument()
      await expect(canvasElement.ownerDocument.location.href).toBe(initialUrl)
      await userEvent.click(canvas.getByRole('button', { name: 'Refresh' }))
      await waitFor(async () => {
        await expect(responses.requests).toHaveLength(2)
        await expect(responses.requests[1]).toMatchObject({ page: 2, released: false })
        await expect(canvas.getByRole('button', { name: 'Refresh' })).toBeDisabled()
        await expect(firstMatch(canvas, 'Chrome on Windows')).toBeInTheDocument()
      }, RESPONSE_WAIT)
      responses.requests[1].release()
      await waitFor(async () => {
        await expect(canvas.getByRole('button', { name: 'Refresh' })).toBeEnabled()
        await expect(firstMatch(canvas, 'Chrome on Windows')).toBeInTheDocument()
        await expect(canvas.getByRole('button', { name: 'Next' })).toBeDisabled()
        await expect(canvas.getByRole('button', { name: 'Previous' })).toBeEnabled()
      }, RESPONSE_WAIT)
      await expect(responses.requests).toHaveLength(2)
      await expect(responses.requests.every((request) => request.released)).toBe(true)
      await expect(canvas.getByText('Sessions (21 total)')).toBeInTheDocument()
      await expect(canvasElement.ownerDocument.location.href).toBe(initialUrl)
    } finally {
      responses.dispose()
    }
  },
}
