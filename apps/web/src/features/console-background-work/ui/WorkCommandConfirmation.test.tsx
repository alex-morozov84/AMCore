import { NextIntlClientProvider } from 'next-intl'
import type { WorkJob, WorkSummary } from '@amcore/shared'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import messages from './work-confirmation-copy.fixture.json'
import { WorkCommandConfirmation } from './WorkCommandConfirmation'

const work: WorkSummary = {
  id: 'image',
  kind: 'ordinary',
  status: 'available',
  definitionVersion: 2,
  sampledAt: '2026-10-10T12:00:00.000Z',
  revision: 'a'.repeat(64),
  capabilities: [],
  presentation: { name: { en: 'Image processing' }, fields: { productId: { en: 'Product' } } },
}
const row: WorkJob = {
  identity: {
    id: 'img-task-456',
    incarnation: '019a1234-1234-7123-8123-123456789012',
    revision: 'b'.repeat(64),
  },
  state: 'completed',
  jobName: 'render',
  wireVersion: 2,
  sampledAt: work.sampledAt,
  source: 'broker',
  replay: 'idempotent',
  attemptsStarted: 1,
  manualGrant: 'none',
  projection: { productId: 123 },
  capabilities: [],
}

function view(operation: 'retry' | 'cancel' | 'cleanup' | 'pause' | 'resume') {
  const confirm = vi.fn()
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <WorkCommandConfirmation
        work={work}
        operation={operation}
        targets={operation === 'pause' || operation === 'resume' ? [] : [row]}
        finalFocus={false}
        onClose={vi.fn()}
        onConfirm={confirm}
      />
    </NextIntlClientProvider>
  )
  return confirm
}

describe('operator confirmation and retained wire semantics', () => {
  it.each(['retry', 'cancel', 'cleanup', 'pause', 'resume'] as const)(
    '%s explains its consequence and keeps diagnostic revisions collapsed',
    async (operation) => {
      view(operation)
      const dialog = await screen.findByRole('dialog')
      expect(
        within(dialog).getByText(messages.console.backgroundWork.control[`${operation}Effect`])
      ).toBeVisible()
      expect(
        within(dialog).getByText(`Captured work state version: ${work.revision}`)
      ).not.toBeVisible()
      expect(within(dialog).getByRole('button', { name: 'Copy ID: image' })).toBeVisible()
      if (operation !== 'pause' && operation !== 'resume') {
        expect(within(dialog).getByText('Product')).toBeVisible()
        expect(within(dialog).getByRole('button', { name: 'Copy ID: img-task-456' })).toBeVisible()
      }
    }
  )

  it('submits the same UTC boundary after editing a native date-time input', async () => {
    const confirm = view('cleanup')
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByText('Additional restrictions'))
    const input = await screen.findByLabelText('Remove records completed before this date (UTC)')
    expect(input).toHaveAttribute('type', 'datetime-local')
    fireEvent.change(input, { target: { value: '2026-10-05T10:20:30' } })
    fireEvent.change(screen.getByLabelText('Reason for the action — recorded in the audit log'), {
      target: { value: 'Checking the business result before cleanup' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm action' }))
    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith(
        'Checking the business result before cleanup',
        '2026-10-05T10:20:30.000Z'
      )
    )
  })
})
