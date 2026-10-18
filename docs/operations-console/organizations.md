# Organizations

[Operations Console](README.md) → Organizations

Use **Organizations** to inspect the system's organization inventory. Each row
shows its name, slug, and creation and update times. Open a row's name for its
full page. The **First organization** panel can create the first organization
and assign a verified recipient `ADMIN` only on an eligible empty installation.
It shares the command's rules and permanently closes after completion.
The inventory/detail pages do not edit/delete organizations. The protected
administrator actions can add canonical ADMIN after explicit confirmation; they
do not replace general member-role management.

See [initial setup](../product-admin/organization-establishment.md#use-console-after-trusted-platform-access)
for prerequisites, account preparation, email proof, confirmation and recovery.
The operator must already have trusted platform access and receives no automatic
company membership. To invite the first ADMIN of a new organization, use [operator provisioning](../product-admin/organization-provisioning.md). This works for the first or a later organization; it does not assign an existing verified account silently.

From the Console home page, select **Organizations** in the left navigation.
The creation action and **Needs attention** appear above the search field.
Trusted initial setup appears only while eligible/relevant or needed to recover an
unknown request. The default create action invites an administrator. For **First organization**, follow **Administrator → Organization → Confirmation**.
Enter the employee's email and select **Continue**. An existing confirmed account can continue immediately;
the page explains when the employee must confirm their email first. **Back** preserves entered details.
The final action is **Create organization**. The result explains who has access and provides **Open organization**.
If the selected account was deleted before completion, choose **Change recipient**
and select another administrator. Organization details remain saved. Confirm the
new account's mailbox before continuing. An unknown creation result must be checked
first; completed setup never replaces its original administrator through this panel.
Once an organization exists, the redundant initial-only unavailable card is hidden.
An unresolved trusted setup stays visible until its result is reconciled.

## Administrators and unfinished invitations

**Needs attention** shows organizations without current administrators and those
with unfinished managed invitations. It includes every matching organization,
with pagination, across operators and browsers. It does not show only your last
creation. Open a row to see current administrators and invitation actions.

The **Needs attention** list refreshes every 30 seconds while its browser tab is
visible. **Refresh list** reads it immediately; it does not send invitations.
The page shows when the list last updated. A read failure stops periodic checks;
use **Refresh list** to retry after resolving the error. These reads cover the
current page and never execute invitation commands.

In an organization, **Invite an administrator** sends a new fixed-ADMIN invitation.
For an existing verified member, use the member search and **Make administrator**.
Both actions require a bounded operational reason, a review step and fresh
platform authentication. The operator does not join automatically.
Several administrators can coexist. Existing roles and administrators remain.

**Change recipient** uses a dialog. **Cancel invitation** has a visible destructive
confirmation. The organization remains, and you can create a new invitation later.
The initial cancelled/completed history stays closed. See
[administrator recovery and headless API](../product-admin/organization-administration.md).

## Find an organization

1. Enter part of its name or slug in **Search organizations**. Results update
   after a short pause across the full inventory, not only the visible page.
2. Select a table heading to sort by **Name**, **Slug**, **Created**, or
   **Updated**. Select it again to reverse the order.
3. Use the page controls to browse matches. Clear the search field to return
   to the full list.

The search and sort appear in the page URL, so a view can be reloaded or
bookmarked. Search terms may contain organization names; consider that before
sharing a URL. Typing updates the current browser history entry, while sorting
and pagination add entries for Back and Forward.

## Open an organization

Select an organization's name to see its ID, slug, timestamps, member count,
and members with their names, email addresses, organization roles, and join
dates. Search members by name or email; results update after a short pause
across all members. Use the page controls for longer lists, and select a member
to open their user page. The total member count remains visible during search.

**Back to Organizations** returns to the source list with its search, sort,
page, and scroll position. A page opened from Audit returns to that Audit view;
browser Back also restores the clicked row if it is still present. A directly
bookmarked organization page returns to the Organizations list. The page
distinguishes no members, no search matches, an out-of-range page, a missing
organization, and a temporarily unavailable service. It shows loading
placeholders for both the initial page and relation refreshes.

**Organization activity** opens Audit filtered to this organization for the
last 31 days, Audit’s widest single interval. Choose an earlier interval to
investigate older activity; an empty result only covers the selected range.

## Empty and unavailable results

**No organizations yet** means the inventory is empty. **No matching
organizations** means no name or slug matches the current search. An
unreachable or failing service shows an unavailable message with a retry
action, rather than an empty list. If a saved page number is beyond the
current result count, use the link to return to the first page.

You can also open [Audit](audit.md) directly, search by the organization's
current name or slug, or filter by an exact organization ID.
