/**
 * English copy of the Scheduled jobs screen for component tests (ASCII punctuation only). It is a
 * local copy on purpose: a test that imports the real catalogue would need a locale seam in a
 * single-locale fork. The real wording is covered by the browser spec; a key missing here fails
 * the test that renders it.
 */
export const scheduledJobsMessages = {
  console: {
    scheduledJobs: {
      title: 'Scheduled jobs',
      eyebrow: 'Periodic work',
      description:
        'Results that the worker processes recorded for the jobs that run on a schedule. Use it to see that cleanups and recovery passes keep running.',
      queuesPointer: 'Queues and commands are on the <link>Background work</link> page.',
      checkedAt: 'Data as of',
      staleLead: 'Showing data from',
      staleTail: 'The last refresh failed.',
      dataHelp:
        'These are results the workers recorded in the database. They do not promise that a job will run again and do not show every worker replica.',
      accessChanged: 'Your access to this page changed. The data is hidden.',
      refresh: 'Refresh',
      refreshing: 'Refreshing...',
      autoRefreshOn: 'Auto-refresh on',
      autoRefreshOff: 'Auto-refresh off',
      autoRefreshHelp:
        'Reloads the data on this page about every 30 seconds while the tab is visible and online. It does not change any job.',
      offline: 'You are offline. Refresh is unavailable.',
      availableIn: '{seconds, plural, one {Available in # second} other {Available in # seconds}}',
      nobodyReported:
        'No worker has reported these jobs yet. Check that a worker process is running and can reach the database.',
      noJobs: 'No scheduled jobs are registered.',
      frequentFootnote:
        'Jobs that run every few seconds show only their latest completed pass. Their current run is not tracked.',
      tableLabel: 'Scheduled jobs',
      columnJob: 'Job',
      columnSchedule: 'Schedule',
      columnResult: 'Last result',
      columnFreshness: 'Freshness',
      columnLastSuccess: 'Last success',
      columnDuration: 'Took',
      result: {
        success: 'Success',
        partial: 'Partly done',
        failed: 'Failed',
        running: 'Running',
        unknown: 'Result not recorded',
        none: 'No runs yet',
      },
      freshness: {
        fresh: 'On time',
        stale: 'Overdue',
        unknown: 'Not known',
        disabled: 'Turned off',
      },
      schedule: {
        daily: 'Daily at {time}',
        everySeconds: '{seconds, plural, one {Every second} other {Every # seconds}}',
        everyMinute: 'Every minute',
      },
      duration: {
        ms: '{n} ms',
        seconds: '{n} s',
        minutes: '{n} min',
        none: 'No duration recorded',
      },
      lastSuccess: {
        none: 'No success recorded',
        earlierSchedule: 'Under an earlier schedule',
      },
      notes: {
        running: 'Running since',
        partialSteps: 'Some steps did not finish: {steps}.',
        partialCount:
          '{count, plural, one {Finished, but # part failed.} other {Finished, but # parts failed.}}',
        failedSteps: 'Failed: {steps}.',
        failedCode: 'Failed: {code}.',
        overdue: 'A success was due by',
        skipped: 'Last skipped run ({reason}):',
        dropped:
          '{count, plural, one {# observation was} other {# observations were}} not recorded under load.',
        notReported: 'No worker has reported this job yet.',
        disabledGeneric: "Turned off in this deployment's configuration.",
        unknownStarted: 'Started',
        unknownRest: 'Its end was not recorded. The worker may have stopped.',
      },
      skipReasons: {
        lock_unavailable: 'the lock service could not be reached',
        not_ready: 'the process was not ready',
        shutdown: 'the process was shutting down',
        busy: 'all workers were busy',
      },
      disabledReasons: {
        geoip_disabled: 'Turned off: GeoIP is disabled (GEOIP_ENABLED is false).',
      },
      buckets: {
        expiredSessions: 'expired sessions',
        expiredPasswordResetTokens: 'password reset tokens',
        expiredEmailVerificationTokens: 'email verification tokens',
        staleTerminalApiKeys: 'old API keys',
        expiredPendingInvites: 'expired invitations',
        staleTerminalInvites: 'finished invitations',
        archivedNotifications: 'archived notifications',
        readNotifications: 'read notifications',
        unreadNotifications: 'unread notifications',
        finishedAttempts: 'delivery attempts',
        telegramLinkTokens: 'Telegram link tokens',
        telegramUpdateReceipts: 'Telegram update receipts',
      },
      codes: {
        bucket_failed: 'Some steps did not finish',
        all_buckets_failed: 'All steps failed',
        isolated_failure: 'Some parts failed',
        maintenance_deferred: 'Postponed to the next run',
        invalid_result: 'Unexpected result',
        unexpected: 'Unexpected error',
        download_failed: 'The download failed',
      },
      history: {
        title: 'Run history',
        loading: 'Loading run history',
        empty: 'No runs recorded yet.',
        unknownRun: 'The end of this run was not recorded.',
        truncated: 'Showing the latest {count} runs.',
        to: '->',
        dot: '.',
      },
      jobs: {
        cleanup: {
          name: 'Cleanup of expired records',
          purpose: 'Deletes expired sessions, tokens, API keys and invitations.',
        },
        'invitation-retention': {
          name: 'Cleanup of invitation records',
          purpose:
            'Deletes old invitation operations, sign-in attempts and administrator invitations.',
        },
        'notification-retention': {
          name: 'Cleanup of old notifications',
          purpose: 'Deletes old notifications, delivery attempts and Telegram records.',
        },
        'geoip-update': {
          name: 'GeoIP database update',
          purpose: 'Downloads the monthly database used to guess a place from an IP address.',
        },
        'notification-recovery': {
          name: 'Notification recovery',
          purpose: 'Picks up deliveries whose wake-up signal was lost and reclaims stuck ones.',
        },
        'ai-run-recovery': {
          name: 'AI run recovery',
          purpose: 'Picks up AI runs whose wake-up signal was lost and reclaims stuck ones.',
        },
        'ai-approval-expiry': {
          name: 'AI approval expiry',
          purpose: 'Closes AI approvals whose time to decide has run out.',
        },
        'invitation-handoff-sweep': {
          name: 'Invitation sign-in sweep',
          purpose: 'Closes invitation sign-in attempts that were not completed in time.',
        },
        'background-control-maintenance': {
          name: 'Background work command upkeep',
          purpose: 'Closes expired administrative commands and removes old command records.',
        },
      },
      noValue: '-',
    },
  },
}
