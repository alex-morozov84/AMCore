# Users

[Operations Console](README.md) → Users

Use **Users** to find a platform account, inspect its profile and organization
memberships, grant and remove `SUPER_ADMIN` access, or view and revoke their
active sessions. The table shows email verification, system role, last
sign-in, and creation and update times.

## Find a user

1. Enter part of a name or email in **Search users**. Results update after a
   short pause; the search covers the full user list, not just the visible page.
2. To order the results, select **Name**, **Last sign-in**, **Created**, or
   **Updated** in the table header. Select the same heading again to reverse
   the order. Verification and system role are not sortable.
3. Use the page controls to move through matching users. Clear the search field
   to return to the full list.

Search and sort are reflected in the page URL, so you can reload or bookmark a
view. The search text may contain a person's name or email; consider that
before sharing its URL. Typing updates the current browser history entry;
sorting and pagination add entries you can revisit with Back and Forward.

## Open a user

Select a user's name to open their full page. It shows the account's safe
contact and status fields, platform system role, timestamps, and organizations
with the user's roles and join date in each one. Search organizations by name
or slug; results update after a short pause across all memberships. Use the
page controls for longer lists and select an organization to open its page.
The total organization count stays visible while a search filters the list.

**Back to Users** returns to the source list with its search, sort, page and
scroll position. A user opened from Audit returns to that Audit view instead.
Browser Back also restores the clicked row when it is still present. A directly
bookmarked user page returns to the Users list. The page shows a distinct
message for a missing user, no memberships, no search matches, an out-of-range
page, or a temporarily unavailable service. Both the initial page and a
refreshing relation list have loading placeholders.

## Understand sign-in setup

The profile shows **Password** as **Configured** or **Not configured**, and
**Linked accounts** lists the names of connected services. A passwordless
account cannot sign in with a password until its owner sets one. Linked
accounts describe saved connections; application settings determine which
sign-in methods are available. These facts do not prove a successful sign-in
or identify how the person originally registered. The Console never shows
passwords, hashes or provider credentials.

Under **Recorded security events**, select:

- **Password confirmations** for recorded password re-entry before protected
  actions. These are not email verification or ordinary sign-in attempts.
- **Access changes** for system-role changes and sessions ended by an operator.
  This view does not cover password resets, self sign-out or provider linking.

Both links open Audit with the user's identity and event types already selected,
for the same last-31-day interval. Choose an earlier interval in Audit to look
further back. The interval is a search limit, not an event retention period.
Ordinary sign-in attempts are not recorded in Audit. Password confirmation
recording is best-effort, and some early refusals create no event. An empty
result does not establish that no sign-in or password confirmation occurred.

No linked accounts is a valid setup fact. If the service fails, the page shows
an error and retry action instead of claiming that the account has no password
or linked accounts. See [Audit](audit.md) for browsing and return navigation.

A failed password confirmation means that the additional verification did not
complete. Possible causes include a wrong password, no active session or no
configured password. The Audit summary does not show that cause. Use the time,
actor and available Request ID to investigate with authorized logs; do not
infer a wrong password from the event name alone.

**Actions by user** searches Audit for this user's actor ID; **Events about
user** searches for events targeting this user. Each link opens the last 31
days, Audit’s widest single interval. Choose an earlier interval there to
investigate older activity; an empty result does not establish that no older
events exist. Only recorded audit actions appear, not every sign-in or visit.

## Help someone sign in

Open the user's detail page and find **Help with sign-in** below their profile.
You need a current personal `SUPER_ADMIN` session. Organization access and API
keys do not authorize these actions. You can also help your own account.

1. Select **Send verification email** for an unverified address, or **Send password
   recovery email** for an account with a configured password.
2. Check the stored recipient and link lifetime in the confirmation. You cannot
   edit the address. A new link cancels the previous link of the same type,
   even when the subsequent email fails. The other type is unaffected.
3. Select **Send email**. If asked, enter **your own password**. Cancelling the
   password dialog prevents continuation. The recipient chooses their new
   password or confirms their address through the email; you cannot do either
   for them.

The email uses the recipient's saved language and opens the website, including
when you use a separate Console host. Password recovery here requires an existing
password. A passwordless account can still use the website's public recovery flow.
Verification needs no password and cannot be sent to an already verified address.

A fresh accepted send shows a toast. **Your last attempt** keeps a short result
and time for each email type. Select **Details** for its explanation. These are
your attempts, not another operator's history. Provider acceptance does not prove
inbox delivery, current link validity, or that the recipient completed the action.
A test-mode result means no real email was sent.

**Refresh details** and **Check result** only read; they never send another email.
If the response is lost, the Console checks the same attempt. You can close a
pending result and reopen **Details**; closing does not cancel a submitted send.
Reloading restores your latest submitted result for each type for 24 hours.
A missing or expired result does not establish that no email was sent.

If sending did not start after link creation, the previous same-type link is
already cancelled. A new email requires a separate confirmation. For an unknown
result, check first: the email may already have been sent. Do not repeatedly send
new links. A newer request can cancel a link that is still travelling to the inbox.
Limits are shared with public recovery: three requests per recipient and email
type, with the hour renewed on admission. Operator sends also share a one-minute
recipient pause and an operator limit of twenty requests per renewed hour.
Wait for the displayed limit before choosing a new send.

If the recipient sees an error after submitting a new password, the password may
already have changed. Ask them to try ordinary sign-in with that password instead
of reusing the link. Inspect or revoke sessions through the existing authorized
controls if needed. Mail results do not establish session revocation. See the
[password completion boundary](../auth/email-auth.md#completion-and-session-failures).

## Change a user's system role

1. Find the user and open the action menu in their row or on their detail page.
   Your own account has no role-change action.
2. Choose **Promote to admin** or **Remove admin access** and read the
   confirmation. The system role has two values: `USER` and `SUPER_ADMIN`.
3. Confirm the change. If asked, enter **your own password** to verify this
   sensitive action. The original change resumes after verification.

A successful change revokes the target user's server-side sessions. Their
existing short-lived access token can remain valid until it expires, but they
must sign in again to obtain a new session and role claim. A promotion does not
give an old token immediate admin access. The Console cannot change your own
role or remove the last `SUPER_ADMIN`.

If the password is wrong, your account has no password, or the request fails,
the role change does not complete. The Console shows an error and leaves the
displayed role unchanged. See [system roles](../auth/rbac.md#layer-1--system-roles)
for the authorization rules.

## Manage sessions

Every user's detail page has a **Sessions** card showing their active
(non-revoked, non-expired) sessions — one row per login, with a
browser-and-OS device label, an approximate location (when available), when
it last re-authenticated, when its current token was issued, and when it
expires.

Use **Refresh** to reload the Sessions card. Existing rows remain readable
while the request is pending; the refresh button shows a spinner and is disabled
until completion. Session controls keep their existing loading guards.

1. Open a user's detail page and find the **Sessions** card below their
   organizations.
2. To end one session, open its row menu and choose **Revoke session**;
   confirm. To end every active session for that user at once, choose
   **Revoke all sessions** in the card header.
3. If asked, enter **your own password** to verify this sensitive action.

Revoking blocks that session's future refresh immediately. An access token
already issued before the revoke can remain valid until it expires (typically
within minutes) — the user is not forced out mid-request, but cannot silently
continue past that point. The Console cannot revoke your own sessions this
way; opening your own detail page shows a note pointing to the product's own
Settings → Sessions page instead.

Device and location are best-effort and informational — a user-agent string
can be spoofed, and a location is an approximate estimate from the stored IP
address, never exact positioning. Neither is authorization evidence. A raw
user-agent string is available behind an explicit disclosure on each row for
diagnostics. Approximate location depends on an optional local GeoIP database
([setup guide](../operations/geoip-setup.md)); when it is disabled, not yet
loaded, or the address is private/reserved, the row shows "Location
unavailable" instead — sessions remain fully visible and revocable either way.

## Empty and unavailable results

**No users yet** means no platform accounts exist. **No matching users** means
the current search found none; try another term or clear the search. If the
service is unavailable, the Console shows an error with a retry action instead
of presenting a misleading empty list. If a bookmarked page is beyond the
current result count, return to the first page using its recovery link.
