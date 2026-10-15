# Account menu, profile and avatar

The product shell shows the signed-in person in the header: a menu with their avatar and name
(email when there is no name), a **Profile** item that opens a dialog, and **Log out**. The profile
dialog shows name and email read-only and lets the person upload, replace or remove a photo. Every
block is built from a public headless operation, so a downstream can move, restyle or replace it.

## Blocks and ownership

| Layer                   | Block                                               | Responsibility                                                                                                         |
| ----------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `entities/user`         | `useCurrentUser`, **`useAvatarEditor`**             | Headless data and operations: `upload(file)`, `remove()`, pending, structured error, outcome. No UI, redirect or toast |
| `entities/user`         | `UserAvatar`                                        | Image or initials presentation (`sm`, `md`, `lg`, `xl`); the image is shown as stored (`next/image` `unoptimized`)     |
| `features/avatar-edit`  | `AvatarEditor` (ready)                              | File picker with the size and type hint, confirmed removal, messages by outcome                                        |
| `widgets/account-menu`  | `AccountMenu`, `ProfileDialog` (ready)              | Menu and controlled dialog; the dialog has no trigger of its own and closes when the signed-in user changes            |
| `widgets/app-shell`     | `headerEnd` slot                                    | The shell renders whatever the application passes; it never imports the account blocks                                 |
| Application composition | `(dashboard)/layout.tsx` and the organization frame | The single placement: both pass `<AccountMenu />` into `headerEnd`                                                     |

The shell footer keeps only the locale switcher. **Log out is now in the account menu**: if you
remove the menu, provide your own logout control (`useLogout` from `features/auth-logout`).

## The headless operation

```ts
import { useAvatarEditor } from '@/entities/user'

const editor = useAvatarEditor()
// editor.user, editor.avatarUrl, editor.status ('idle' | 'pending' | 'error'),
// editor.action, editor.error, editor.outcome, editor.isPending
const outcome = await editor.upload(file) // or editor.remove()
```

Every call returns one outcome, also kept in `editor.outcome`:

| Outcome                                           | Meaning                                                                                  | What a UI does                                    |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `committed`                                       | The server stored or removed the avatar; the cached user already has the new `avatarUrl` | Show success                                      |
| `rejected` (`too_large`, `invalid_type`, `other`) | Refused (by the pre-check or by the server); nothing changed                             | Show the reason; `other` takes `ApiErrorAlert`    |
| `busy`                                            | Another avatar change is running (here or on the server, `503`/`429`)                    | Ask the person to retry shortly                   |
| `unknown`                                         | Network loss or a server error: the change may or may not have happened                  | Tell them to reload; never retry blindly          |
| `retired`                                         | The signed-in user changed while the request was in flight; the result was dropped       | Nothing: the new identity's state was not touched |

A result that arrives after the user changed never writes state or cache for the new person. The
pre-check uses `AVATAR_LIMITS` (2 MB; JPEG, PNG or WebP) only to save a round trip; the server
re-checks the real bytes. Failures are sorted by HTTP status, never by message text.

## Place or replace the menu

`AccountMenu` is placed once in each shell composition:

```tsx
<AppShell headerEnd={<AccountMenu />} /* ... */ />
```

To move it (sidebar footer, own shell), render `<AccountMenu />` elsewhere. To restyle it, edit the
JSX; it uses shared primitives and semantic tokens. To replace it, build your own UI over
`useCurrentUser` and `useAvatarEditor` and pass it to `headerEnd`, or drop the slot.

### Executed custom-UI example

`node scripts/fixtures/account-avatar-headless.mjs` prepares a disposable copy of the repository,
swaps `AccountMenu` for an inline component that uses only `useCurrentUser`, `useAvatarEditor` and
`UserAvatar` (no menu, no dialog, no ready block), adds a real-stack browser test and prints the
command to run it. Add `--projected` to prepare it after `init:project` choices. The test uploads
and removes a photo through the real API and checks that the image loads and the page has no axe
violations.

## Where avatars come from

The database stores the avatar's object key; the API computes `avatarUrl` on every response (see
[uploads](../storage/uploads.md)). The browser loads the image from the origin of
`STORAGE_PUBLIC_BASE_URL`, so the web service needs `WEB_PUBLIC_FILES_ORIGIN` set to that origin
(see [browser security and CSP](../frontend/browser-security-and-csp.md#public-files-avatars)).

## Acceptance checklist

- The menu and dialog work with keyboard only; Escape closes the dialog and focus returns to the
  menu button.
- Narrow screens show only the avatar on the menu button; the menu still opens.
- A wrong type, an oversized file, a busy server and an unknown result each show a clear message.
- The avatar image loads without a CSP violation from the configured public files origin.
- Log out works from the menu; no other logout control remains in the product shell.
- The fixture above runs green after any change to the shared operation.
