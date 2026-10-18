# UI/UX: before showing a screen

Design for a person who has not read the source or discussed the task with you.
A working API and passing tests do not prove that the interface is understandable.

For a new or materially changed journey, apply these checks before implementation
and again before the owner preview:

1. **Start with the person's goal.** State who uses the screen, what they need
   to finish, and how they recognize success. Do not expose internal task boundaries.
2. **Use familiar patterns.** Reuse AMCore controls and journeys. For unfamiliar
   interactions, inspect current official design guidance or mature product examples.
   Match goal and consequence, not appearance. If none fits, compose AMCore patterns and justify the choice.
3. **Make the next action clear.** Show one primary next action. Group alternatives
   by purpose; separate destructive actions from the main path. Keep controls near their data.
4. **Write for people.** Name the action and its object, such as “Refresh list”.
   Explain what happened, what happens next, and what the person can do.
   Use names, not raw IDs. Explain data loss, access changes and invalidated links visibly, not only in tooltips.
5. **Explain consequences before confirmation.** Separate form, review and result
   when the action needs them. Make cancellation unambiguous. Back preserves input;
   clearing a draft is explicit. Explain irreversible effects before the final action.
6. **Complete the recovery path.** Cover empty, loading, success, refusal, failure
   and unknown results. Keep unfinished work discoverable. Refresh shows freshness;
   it must not imply a resend or a successful mutation. Offer a safe next step.
7. **Inspect the actual screen.** Walk the changed journey without author explanations.
   Check supported languages, desktop and narrow layouts, keyboard and accessibility.
   Inspect text and button bounds inside dialogs, not only page overflow.

Before handoff, record the relevant pattern choice, actual checks and remaining gaps
in the project's work record or PR. Owner means the person accepting the product; preview is not the first usability check.
Technical details: [interaction patterns](./architecture-and-conventions.md#interaction-patterns-buttons-tabs-and-lists)
and [runtime verification](./testing.md).
