# Accept an organization invitation

Open your invitation email and review the organization and roles before joining.

## Follow the recipient link

1. Open the original email link. Sign in with the invited account or register
   with its fixed email. Password fields support show/hide. An incorrect password
   shows an error and allows retry once the current invitation state is synchronized.
   A rate-limit rejection also synchronizes the state; wait as instructed before
   submitting again. A lost response requires recovery before another submission.
2. Verify email if requested. Email verification itself does not sign you in or
   join the organization. If verification opens another tab, return to the
   invitation tab and check verification, or reopen the original email link.
3. Review the organization, complete role set and confirmation deadline, then
   explicitly choose **Accept invitation**. This is the only step that joins.
4. Open the organization after success. If access already existed, existing roles
   remain unchanged. Leaving the screen does not revoke an invitation.

A different signed-in account gets a switch-account action before private
organization/role details are shown. An expired, revoked or superseded link cannot
join. Ask the manager for a fresh invitation. The original email URL can be opened
in another browser; the later flow address requires that browser’s cookies and
cannot transfer authority to another device. The confirmation window lasts at
most 30 minutes and may end before the invitation’s seven-day deadline. Reopen the
original email when instructed. Password reset revokes sessions: sign in again
and reopen the link.

`AUTH_PUBLIC_SIGNUP_ENABLED=false` closes ordinary email and new-account OAuth
signup while allowing existing-account login and valid invitation registration.
The server enforces this policy; hiding UI is insufficient. Invited OAuth must
match the invitation email and the configured provider verification rules.


## Custom presentation

Recipient headless state and ready composition are described in [custom invitation forms](integration.md#custom-invitation-forms).
