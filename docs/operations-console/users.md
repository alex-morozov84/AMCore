# Users

[Operations Console](README.md) → Users

Use **Users** to find a platform account, inspect its email verification and
current system role, or grant and remove `SUPER_ADMIN` access. The table also
shows last sign-in and account creation and update times. There is no user
detail page, session viewer, or account recovery control here.

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

## Change a user's system role

1. Find the user and open the action menu in their row. Your own row has no
   role-change action.
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

## Empty and unavailable results

**No users yet** means no platform accounts exist. **No matching users** means
the current search found none; try another term or clear the search. If the
service is unavailable, the Console shows an error with a retry action instead
of presenting a misleading empty list. If a bookmarked page is beyond the
current result count, return to the first page using its recovery link.
