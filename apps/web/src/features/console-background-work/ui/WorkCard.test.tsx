import { NextIntlClientProvider } from 'next-intl'
import type { WorkSummary } from '@amcore/shared'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { WorkCard } from './WorkCard'

// Local behavior messages survive removal of a locale catalogue during scaffolding.
const messages = {
  console: {
    backgroundWork: {
      paused: 'Paused',
      notPaused: 'Not paused',
      control: {
        availability: {
          available: 'Data available',
          unavailable: 'Data unavailable',
          disabled: 'Disabled',
        },
        availabilityHelp: {
          available:
            'The Console could read the current state. This does not confirm worker health, successful execution or permission for every action.',
          unavailable:
            'The Console could not read the control source. This is not an empty queue; retained provider records may still be available.',
          disabled: 'This kind of work is disabled in this deployment.',
        },
        sourceDomain: 'Jobs in the database',
        sourceDomainHelp:
          'Business work state is stored in the database. A queue may only signal when to process it.',
        sourceBroker: 'Queue jobs',
        sourceBrokerHelp: 'Job state is read from the background-processing queue (broker).',
        updatedAt: 'Updated',
        separator: ' · ',
        unsupportedQueue: 'Queue-wide pause is not supported',
        unsupportedQueueHelp:
          'This kind of work has no queue-wide pause/resume control. Individual actions depend on each job’s state and policy.',
        pausedHelp:
          'Already running jobs can finish. New jobs can still be added, but workers cannot claim them while paused.',
        notPausedHelp:
          'Workers may claim the next job. This does not confirm that a worker is running.',
        inspectJobs: 'Inspect jobs',
        actions: {
          pause: 'Pause',
          resume: 'Resume',
          retry: 'Retry',
          cancel: 'Cancel',
          cleanup: 'Clean up',
        },
      },
    },
  },
  errors: {
    WORK_UNAVAILABLE: 'Work data is unavailable.',
  },
}

const work: WorkSummary = {
  id: 'example',
  kind: 'ordinary',
  status: 'available',
  definitionVersion: 1,
  sampledAt: '2026-10-10T12:00:00.000Z',
  capabilities: [],
}
function view(value: WorkSummary) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <WorkCard
        work={value}
        selected={false}
        blocked={false}
        onInspect={vi.fn()}
        onCapture={vi.fn()}
      />
    </NextIntlClientProvider>
  )
}

describe('registered work card', () => {
  it('describes data access separately from pause and worker health', () => {
    view({ ...work, paused: false })
    expect(screen.getByRole('article')).toHaveAttribute('data-slot', 'card')
    expect(screen.getByText('Data available')).toBeInTheDocument()
    expect(screen.getByText('Not paused')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /does not confirm that a worker is running/ })
    ).toBeInTheDocument()
  })
  it('omits only an explicitly unsupported queue-level action pair', () => {
    view({
      ...work,
      kind: 'durable',
      capabilities: [
        { operation: 'pause', allowed: false, reason: 'ACTION_UNAVAILABLE' },
        { operation: 'resume', allowed: false, reason: 'ACTION_UNAVAILABLE' },
      ],
    })
    expect(screen.getByText('Jobs in the database')).toBeInTheDocument()
    expect(screen.getByText('Queue-wide pause is not supported')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument()
  })
  it('does not guess a queue action when its state is unavailable', () => {
    view({ ...work, status: 'unavailable', capabilities: [] })
    expect(screen.getByText('Data unavailable')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument()
    expect(screen.queryByText('Not paused')).not.toBeInTheDocument()
  })
  it.each([
    [false, 'Pause', 'Resume', 'pause'],
    [true, 'Resume', 'Pause', 'resume'],
  ] as const)(
    'shows only the next queue action for paused=%s',
    (paused, shown, hidden, operation) => {
      view({ ...work, paused, capabilities: [{ operation, allowed: true }] })
      expect(screen.getByRole('button', { name: shown })).toBeEnabled()
      expect(screen.queryByRole('button', { name: hidden })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: shown }).querySelector('svg')).toHaveAttribute(
        'aria-hidden',
        'true'
      )
    }
  )
  it('identifies disabled work and refuses inspection', () => {
    view({ ...work, status: 'disabled' })
    expect(screen.getByText('Disabled')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Inspect jobs' })).toBeDisabled()
  })
})
