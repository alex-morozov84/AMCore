/** Locale-independent queue copy; parity is checked by QueueCatalogue.locale.test.tsx. */
const ELLIPSIS = String.fromCodePoint(0x2026)
const EM_DASH = String.fromCodePoint(0x2014)

export const queueMessages = {
  console: {
    backgroundWork: {
      title: 'Background work',
      eyebrow: 'Queues',
      description: 'Monitor background tasks, investigate failures and manage supported actions.',
      boardPointer: 'Bull Board provides a separate technical, view-only queue dashboard.',
      scope:
        'Figures come from the queues of the Redis configured for this API, shared by every API and worker process. They show where work is waiting, not whether workers are running.',
      board: {
        noteBody:
          'Browse queue status and job details. Retrying or deleting jobs and managing queues is not available here, and some job details are hidden.',
        openLink: 'Open queue board',
        openLinkNewTab: '(opens in a new tab)',
        rowLink: 'Open in queue board',
        disabledTitle: 'Queue board is not enabled',
        disabledBody:
          'The board is off because <code>ENABLE_BULL_BOARD</code> is not <code>true</code> in the environment of the API process. To turn it on, set <code>ENABLE_BULL_BOARD=true</code> in the API process environment (not in the <code>.env</code> file) and restart the API. Turning it on does not change what the board allows: it stays view-only.',
        disabledGuideLink: 'Queue board guide',
        unavailableTitle: 'Could not open the queue board',
        unavailableBody: 'Check that the API is available and try again.',
      },
      checkedAt: 'Last refreshed',
      refresh: 'Refresh',
      refreshing: 'Refreshing' + ELLIPSIS,
      autoRefreshOn: 'Auto-refresh: on',
      autoRefreshOff: 'Auto-refresh: paused',
      autoRefreshHelp:
        'Refreshes about every 30 seconds while this tab is visible and online. Pausing it does not pause any queue.',
      offline: 'You are offline',
      availableIn: '{seconds, plural, one {Available in # second} other {Available in # seconds}}',
      staleNotice: 'Showing data from {time}. The last refresh failed.',
      allUnavailable:
        'No queue could be read. Unavailable does not mean empty; check Redis and the API.',
      accessChanged: 'Access changed. Verifying' + ELLIPSIS,
      noQueues: 'No queues are configured.',
      tableLabel: 'Background queues',
      technicalName: 'Technical name',
      columnQueue: 'Queue',
      columnState: 'State',
      columnWaiting: 'Waiting',
      columnActive: 'Active',
      columnDelayed: 'Delayed',
      columnFailed: 'Failed',
      columnOldest: 'Oldest queued job',
      paused: 'Paused',
      notPaused: 'Not paused',
      empty: 'Empty',
      unavailable: 'Unavailable',
      disabled: 'Disabled',
      pausedHint: 'Jobs stay waiting and are not processed until the queue is resumed.',
      unavailableHint: 'Could not be read. This is not an empty queue.',
      disabledHint: "Turned off in this deployment's queue inventory. Nothing is read.",
      delayedHint: 'Scheduled or retrying work. It is not necessarily a problem.',
      failedHint:
        'Retained failed jobs only. BullMQ trims them by age and count, so this is not a lifetime total.',
      oldestHint:
        'Creation age of the oldest job found in a small sample at the front of the line. A lower bound, not time spent waiting.',
      ageAtLeast: 'At least {age}',
      ageNone: 'Nothing waiting',
      ageUnknown: 'Unknown',
      ageSeconds: '{n, plural, one {# second} other {# seconds}}',
      ageMinutes: '{n, plural, one {# minute} other {# minutes}}',
      ageHours: '{n, plural, one {# hour} other {# hours}}',
      ageDays: '{n, plural, one {# day} other {# days}}',
      queues: {
        email: {
          title: 'Email',
          description:
            'Sends transactional email that is safe to queue. Messages with secret links are sent directly and never appear here.',
        },
        default: {
          title: 'Default',
          description:
            'Observed queue without a managed worker. Processing and administrative commands are unavailable.',
        },
        notifications: {
          title: 'Notifications',
          description:
            'Wake signals only. Delivery state is stored in the database, so an empty queue does not mean nothing is pending.',
        },
        'ai-runs': {
          title: 'AI runs',
          description:
            'Wake signals only. Run state is stored in the database, so an empty queue does not mean nothing is pending.',
        },
      },
      kinds: {
        work: {
          title: 'Work queue',
          description: 'Jobs carry the work itself.',
        },
        wake: {
          title: 'Wake queue',
          description:
            'Wake signals only. State lives elsewhere, so an empty queue does not mean nothing is pending.',
        },
        extension: {
          title: 'Custom queue',
          description: 'Defined by this deployment.',
        },
      },
      noFigure: EM_DASH,
      overviewTitle: 'Queue overview',
      overviewDescription:
        'Counts describe broker queues. Task management also includes work stored directly in a database, which has no queue row.',
      partialRefresh:
        'Some sections could not be refreshed. Previous data remains visible with an error; the timestamp applies to the queue overview.',
    },
  },
} as const
