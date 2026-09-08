# Email runbooks

Covers `docs/operations/prometheus/amcore-alerts.yml`'s `amcore-email` group.

## Dead-letter

**Symptom:** `AMCoreEmailDeadLetterTicket` (any dead-lettered email in 15m) or
`AMCoreEmailDeadLetterBurstPage` (>5 in 15m) is firing, for template
`{{ $labels.template }}`.

**Likely causes, ranked:**

1. A template-specific local render failure, or provider rejection caused by
   the rendered content or addresses.
2. A provider-wide outage or credential/config problem, affecting every
   template roughly evenly.
3. A burst of recipient-side bounces (invalid/nonexistent addresses) — less
   likely to cluster by template unless that template is tied to a specific
   flow with unusually stale addresses (e.g. a re-engagement email).

**Diagnostic steps:**

1. Query directly:

   ```promql
   increase(amcore_email_dead_letters_total[15m])
   ```

   Break down by `template` to see whether one template or several are
   affected — several at once points at a provider-wide or credential
   problem rather than a template-specific one.

2. The exact recipient is deliberately not in the metric (redacted by
   design) — check structured logs in your deployment's log destination
   (correlate by `template` and timestamp) or, when Bull Board is enabled, its
   job record. Failed jobs are retained for only 24h or 1000 jobs, whichever
   comes first.
3. Open the **"Dead-letter rate"** dashboard panel (Email row) for the trend
   and scale, and the **"Operations by result"** panel (Email row) for the
   surrounding `send`/`dispatch` error rate — a correlated rise there points
   at a provider-wide problem rather than isolated bounces. Check the email
   provider's own status page/dashboard directly too — this alert only
   observes the effect from the application side.

**Mitigation:**

- If provider-wide: this is outside AMCore's control beyond waiting out the
  provider's incident; confirm no application-side retry storm is making it
  worse in the meantime.
- If template-specific: fix the template's content/rendering (a malformed
  address field, a broken merge tag). Re-queue a retained job only after the
  fix, and only when Bull Board is explicitly enabled and writable
  (`ENABLE_BULL_BOARD=true`, `BULL_BOARD_READ_ONLY=false`).
- If bounce-driven: this is expected steady-state noise for the affected
  flow, not an incident — no mitigation needed beyond normal address-hygiene
  practices upstream of AMCore.

**Escalation:** `Ticket` (any single dead letter) — inspect the retained job
before its retention window expires when Bull Board is available, but not
urgent otherwise. `Page` (>5 in 15m) means a likely
provider-wide or template-wide failure — escalate per your organization's
on-call process.
