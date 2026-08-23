/**
 * The cookie `SidebarProvider` writes on every toggle, and that
 * `(dashboard)/layout.tsx` reads back server-side via `await cookies()` to
 * restore the collapsed/expanded state across a reload.
 *
 * **Deliberately its own module, not an export from `sidebar.tsx`.**
 * `sidebar.tsx` carries `'use client'`, and Next replaces every export of a
 * client module with a client *reference* when a Server Component imports
 * it — so `cookies().get(SIDEBAR_COOKIE_NAME)` silently looked up a proxy
 * object instead of the string, always missed, and the sidebar always
 * reopened expanded. Verified live against the standalone server: the
 * cookie was present on the request and the server still rendered
 * `data-state="expanded"`. A plain module has no such boundary, so both
 * sides read the same literal.
 */
export const SIDEBAR_COOKIE_NAME = 'sidebar_state'
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
