# Audit

[Operations Console](README.md) → Audit

Use **Audit** to investigate system activity: when an event occurred, which
action was recorded, who initiated it, and what it affected. The screen opens
with the last seven days of events, so you can begin without knowing an ID.
It shows a table on wide screens and cards on narrow screens.

## Read an event

Each entry shows a time, action, actor, target, and organization when present.
A short coded result appears for actions that have one. Badges distinguish
users, API keys, system jobs, and other actor or target types. A dash means
that the event has no value for that field.

For a user or organization that still exists, the entry can show its **current**
name, email, or slug. These details may have changed since the event. If the
current record cannot be found, use the ID; the screen does not infer a
historical name or deletion reason. Select a current user's or organization's
name to open its detail page. A return link leads back to the filtered Audit
view, and browser Back restores the clicked result and scroll position when
that result is still present. Copy icons appear beside safe IDs. The
event's own ID identifies its audit record and can be copied for a support or
investigation reference; the screen has no event-ID search field.

## Narrow the events

1. Choose up to ten values under **Event type**. An event matches when its
   action is any selected value. The menu lists actions known to this
   application version. If an event has an older, unlisted action code, use
   the filter icon in its row to select that exact action.
2. Choose **Last 24 hours**, **Last 7 days**, or select two dates in the range
   calendar. You can adjust the start and end times below the calendar.
3. To filter by a person, choose **Actor** or **Target**, search their current
   name or email, and select a suggestion. Search an organization's current
   name or slug in the adjacent field. Enter or **Find** runs a lookup
   immediately. If more than ten suggestions match, narrow the search text.
4. Choose **Apply filters** for the event types, date range, and exact IDs you
   entered. **Clear filters** returns to the recent seven-day view.

Selecting an identity suggestion applies that ID immediately without applying
other unsubmitted changes in the form. For a known ID, open **Filter by exact
ID**. A result's filter control beside an action, actor, target, or organization
applies its exact value to the current interval. On narrow screens,
choose **Show filters** to open the form. There is no general free-text search
over event contents.

## Choose the time zone and range

The selected date range stays visible above the filters, including when the
filter form is collapsed on a narrow screen. The time-zone switch above the
filters applies to every date and time on the screen. It starts at **UTC**;
**Local time** uses your browser's time zone and
shows its current UTC offset. Switching zones changes how the same interval
is displayed, not which events belong to it.

The start of an interval is included; its end is excluded. A range can span
at most 31 days and cannot end in the future. Future calendar days are
disabled, and today's time fields stop at the current time. New calendar
selections start with seconds set to `00`; you can adjust them. Selecting
dates or a preset changes the form, so choose **Apply filters** to load that
interval. If a local time is ambiguous or does not exist during a clock
change, the form shows an error.

## Browse and recover

**Older** and **Newer** move between pages within the chosen time interval.
At the end, choose an earlier interval to reach older history. **Show audit
views** reveals events created by Audit browsing; those events are hidden by
default, but every successful read is still recorded, even when no entries
match. Empty intervals, unmatched filters, invalid page cursors, and service
failures have distinct messages. An invalid cursor offers a restart with the
same filters. No matching events means none in the selected range and filters;
it does not rule out activity outside that interval. Links from user and
organization detail pages use the last 31 days; choose an earlier interval to
look further back.

The URL contains exact filter IDs and the page cursor, but current-name lookup
text stays out of it. Handle bookmarked or shared URLs accordingly. The
screen exposes a limited event summary, not raw metadata, IP addresses, or
export. Access requires a current `SUPER_ADMIN` session. See the
[audit-log read contract](../operations/audit-log.md#read-access) for the
privacy, pagination, and deployment rules.
