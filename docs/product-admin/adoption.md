# Add product administration to your product

Use the ready pages as your application's administration area, or build your own
interface over the public headless modules. This guide helps a product developer
choose the composition, initialize a clean fork and prepare a local demonstration.
Business modules such as orders, inventory and CRM records belong to your product.

## Choose a recipe

### Public shop with staff administration

Keep buyers separate from staff. For example, customers buy products while three
employees manage the shop. Keep the immutable staff organization ID on the server
and hide the organization selector. Choose shared website login or independent
staff-host login. The Operations Console is for platform operators; it is separate
from this staff area.

### CRM or ERP as the working application

People sign in and work directly in the application. For example, salespeople use
CRM records while authorized administrators manage the team. Choose one hidden
company or an explicit organization selector. Show team administration only with
the required capabilities. The ready shell needs no new root mount or `basePath`.

### SaaS with several organizations

Configure public registration and self-service organization creation independently.
For example, a new account creates a company, invites colleagues, then switches
between companies where it holds membership. Preserve invitation consent and
organization selection. Registration alone grants no staff membership.

The ready composition demonstrates the shell, organization selection and management
modules. The custom composition demonstrates a fixed company and a different visual
style. The existing host and invitation fixtures cover independent
sessions and recipient consent; they do not require a third example product.

A hidden selector still uses the backend organization model. Use the
[trusted setup](organization-establishment.md) or
[operator invitation](organization-provisioning.md) to obtain the real immutable ID.
Keep it in server-owned composition. Never select staff membership from buyer input
or from whichever organization happens to appear first.

See [placement and sessions](placement-and-sessions.md) before choosing path or host
login. Path mode shares the website session. Host mode uses an independent staff
session; moving pages alone does not establish that boundary.

## Initialize a clean product

Use the supported Node version and the `packageManager` version in your checkout.
Start with a clean fork, without maintainer context, credentials or copied dependencies.
Install its frozen dependencies and prepare the shared/API generated artifacts:

```sh
pnpm install --frozen-lockfile
node scripts/api-e2e-ci.mjs --prepare
pnpm exec husky
```

1. Initialize product identity. The values below belong to this example; substitute
   your product's identity for a real fork. Inspect the dry run, then apply it.

   ```sh
   pnpm init:brand --product-name 'Example staff app' --purpose 'Internal staff administration' --product-description 'Example staff application' --upstream-sync-policy 'Manual reviewed updates' --workflow-mode flexible --theme-mode system --theme-persistence local-storage --package-name example-staff-app --dry-run
   pnpm init:brand --product-name 'Example staff app' --purpose 'Internal staff administration' --product-description 'Example staff application' --upstream-sync-policy 'Manual reviewed updates' --workflow-mode flexible --theme-mode system --theme-persistence local-storage --package-name example-staff-app --yes
   ```

2. Inspect the changes. With these flags, the brand files are the paths below.
   Review any additional reported path before staging it. Commit the identity before
   other changes, so later review diffs stay small.

   ```sh
   git add -- PROJECT_CONTEXT.md package.json apps/web/src/app/manifest.ts apps/web/messages/en.json apps/web/messages/ru.json
   git diff --cached --check
   git diff --cached
   git commit -m 'chore: initialize product identity'
   git status --short
   ```

This build ships one set of project choices, recorded in `PROJECT_CONTEXT.md`. There
is no additional initializer for them and no product-admin/headless-only initializer
or finalizer.

## Connect the chosen interface

The [ready-page entry](README.md#connect-the-ready-pages) documents the physical
routes and composition imports. The default administration area is `/manage`.
An empty membership list permits creation only when policy allows it. One membership
opens that organization; `?view=list` retains explicit selection. Several memberships
show the selector. Every selected page still checks current membership and authority.

The custom shop demonstration (`node scripts/fixtures/organization-shop-headless.mjs
--preview`) needs a single-language product without the Operations Console. This build
ships neither, so the generator refuses `--preview`. Run it without that flag to prepare
the custom code in a disposable directory, and follow the commands it prints.

The fixed ID in a generated demonstration is not a production setup mechanism.
For a real product, substitute your trusted organization ID in the server mount.
Keep its membership/TeamAccess check and explicit login destination.

The member, role and invitation generators also preserve the source's current
locale and feature choices. They replace current mounts in a separate copy.
Run them without extra flags.

## Your own appearance

Headless modules provide operations and state. Your product owns markup, typography,
colors, layout and control presentation. The ordinary ready pages and the cosmic
shop example use the same public organization-context APIs.

In the generated shop copy:

- `_pages/shop-team/ui/shop-team.tsx` composes the product presentation.
- `shop-directory.tsx` owns search and member tiles; selecting a member opens a full-width dossier.
- `shop-dossier.tsx` owns the identity and Roles/API keys/Membership sections.
- `shop-operations.tsx` preserves operation state across those sections.
- `shop-roles.tsx`, `shop-keys.tsx` and `shop-membership.tsx` consume public headless hooks directly.
- `shop-team.module.css` owns the page's panels, spacing and control geometry.
- `apps/web/src/app/globals.css` owns light/dark semantic color values. Root values
  also reach login and confirmation dialogs rendered outside the page container.

Replace these product-owned presentation choices while retaining the public module
contract. Use the existing [semantic tokens](../frontend/brand-theme-and-tokens.md)
and shared controls. Keep keyboard focus, contrast, translations and confirmation
meaning. Independent markup does not automatically prove accessibility. The ready table/row menus
and the shop directory/dossier demonstrate different journeys over the same public operations.
Back and section changes require an explicit decision before discarding a role draft.
Pending and unknown operations stay mounted and block unsafe navigation.

## Verify and recover

Use the [managed stand commands](../operations/local-stands.md) printed by each
generator for its real-stack check. Preparing or compiling a copy is not runtime proof.
Check an authorized user, a buyer/nonmember, a real foreign organization, changed login,
failed primary/secondary reads, one-time key concealment and irreversible removal.
The invitation-management response proves issuance; the dedicated mail fixture proves
rendered mail and explicit consent. The three-host fixture proves session separation.

Show the current status of retained [member-key records](member-api-keys.md).
Revoking a key disables authentication; it does not imply deleting its inventory row.

Render cached resource data only when its `available` flag is true. Preserve a dirty
draft separately from the current snapshot and revision. A committed write with a failed
refresh remains committed. An unknown outcome requires inspection; refreshing must not
repeat the write. See the [member](organization-members.md), [role](role-definitions.md)
and [invitation](invitations.md) contracts for exact outcomes and recovery.

Key-bearing examples disable traces, screenshots and video in the specs, including
CI retries/failures. Ordinary HTML reports may contain safe statuses and assertions,
never raw credentials, response/DOM attachments or secret-bearing errors. Mail/token-URL
fixtures retain their stricter step-free list reporter without HTML. Keep one-time
secrets in memory, acknowledge/clear them, and close every credential-bearing page safely.

Use `pnpm stand down --id custom-team` to stop the preview while retaining its data.
Delete owned demo data only deliberately with the documented `--purge` command.
