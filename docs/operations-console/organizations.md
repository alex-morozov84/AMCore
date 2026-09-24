# Organizations

[Operations Console](README.md) → Organizations

Use **Organizations** to inspect the system's organization inventory. Each row
shows its name, slug, and creation and update times. This screen is read-only:
it cannot create, edit, or delete an organization, and it has no organization
detail page.

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

## Empty and unavailable results

**No organizations yet** means the inventory is empty. **No matching
organizations** means no name or slug matches the current search. An
unreachable or failing service shows an unavailable message with a retry
action, rather than an empty list. If a saved page number is beyond the
current result count, use the link to return to the first page.

To inspect recorded activity involving an organization, use [Audit](audit.md)
and search by its current name or slug, or filter by an exact organization ID.
