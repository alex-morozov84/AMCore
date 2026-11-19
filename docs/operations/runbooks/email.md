# Email runbooks

## Dead-letter

`AMCoreEmailDeadLetterTicket` fires for any recorded dead letter in 15 minutes.
`AMCoreEmailDeadLetterBurstPage` fires when one time series increases by more than five in 15 minutes.

1. Check the labels on the firing alert to identify the affected series.
   Use this query to find affected templates across sources:

   ```promql
   sum by (template) (increase(amcore_email_dead_letters_total[15m]))
   ```

   The query sums series by template for diagnosis. The alert evaluates each
   series separately. Two series that each increase by three give a template
   total of six without crossing the page threshold on either series.

2. Check the **Dead-letter rate** and **Operations by result** panels for the
   affected window. Correlate bounded logs by template and time. When Bull
   Board is available, inspect the retained job there. The board shows only
   safe metadata and offers no retry action. Failed email jobs are subject
   to the 24-hour and 1,000-job retention limits.
3. Inspect the recorded failure and delivery certainty. Compare with provider
   health and check sender or credential configuration if several templates
   fail. Use provider evidence to establish a recipient bounce. The dead-letter
   count alone cannot establish that a provider accepted or bounced a message.
4. Fix a render or configuration problem for future sends. Retained jobs keep
   their frozen request. Follow the [managed retry policy](../../email/queued-safety.md#retry-window-and-cooldown)
   for eligible retries. Leave `unknown` and `accepted` outcomes alone.
   A separate business reissue requires a duplicate-risk decision.

Inspect a ticket while evidence remains available. Escalate a page through
your on-call process.
