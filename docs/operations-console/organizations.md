# Organizations

[Operations Console](README.md) → Organizations

Use **Organizations** to inspect the system's organization inventory. Each row
shows its name, slug, and creation and update times. Open a row's name for its
full page. These pages cannot create, edit, or delete an organization or change
its members' roles.

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
