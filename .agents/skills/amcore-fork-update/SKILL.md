---
name: amcore-fork-update
description: Create a product from an AMCore release or merge a newer AMCore release into an existing product. Use in AMCore downstream products and their agent clones for repository choice, initialization, release updates, conflicts, migrations and recovery. Excludes ordinary feature work inside AMCore itself.
---

# AMCore product creation and updates

The [fork update guide](../../../docs/operations/updating-a-fork.md) is the contract.
This skill orders its steps and lists where an agent must stop. It adds no rule.
When this file and the guide disagree, follow the guide and report the difference.

## Before any action

1. Read `PROJECT_CONTEXT.md`. For an update, it must say `downstream-product`;
   stop if a product still says `upstream-starter`. A new product changes it only
   during initialization below.
2. Read the guide banner. While it says that no supported starting release exists,
   no tag is a supported target: do not create a product or update one to any tag
   as a supported release. Report that limit instead.
3. Confirm the owner's permission for each outward action: repository creation,
   push, PR, merge, settings and network CLI access. A request to update is not
   permission to publish.

## Create a product

Follow these guide sections in order:

1. [Choose the repository and protection mode](../../../docs/operations/updating-a-fork.md#choose-the-repository-and-protection-mode):
   an open product may use a GitHub Fork; a product that may become closed uses an
   independent copy. A private product without the security features uses `flexible`.
2. [Initialize once, from the supported source tag](../../../docs/operations/updating-a-fork.md#initialize-once-from-the-supported-source-tag):
   verify the tag and full SHA, initialize before any product commit, check
   `initialized_from_amcore_version`, then deliver.
3. [Prepare every clone](../../../docs/operations/updating-a-fork.md#prepare-every-clone-including-an-agent-clone),
   including your own agent clone.

## Update a product

1. Prepare the clone as above. Then follow
   [Update to a selected release](../../../docs/operations/updating-a-fork.md#update-to-a-selected-release)
   step by step. Read every intervening release note first.
2. Resolve conflicts with [the conflict table](../../../docs/operations/updating-a-fork.md#resolve-common-conflicts).
   Never take a whole side for identity, permission, data or the lockfile.
3. For any migration change, follow
   [Preserve database history](../../../docs/operations/updating-a-fork.md#preserve-database-history-and-rehearse-data-changes)
   on disposable databases before rollout.
4. Commit with hooks enabled and compare the saved tree with `HEAD`, as the guide shows.
5. Deliver through a product PR with a **merge commit**, then prove ancestry.
   Deployment is a separate operation.

For a failed step, a partial security fix or an accidental squash, use
[Abort, recover, or take a partial fix](../../../docs/operations/updating-a-fork.md#abort-recover-or-take-a-partial-fix).

## Stop and ask the owner

Stop, keep the current state and report when any of these happens:

- histories are unrelated, or a tag moved or does not match its recorded SHA;
- a remote, the CLI default repository or the PR base points to the wrong repository;
- a conflict touches security, permissions, identity or data and the right side is unclear;
- a migration fails, Prisma reports drift, or a tool proposes a reset;
- a required check is missing, skipped or red, or a GitHub feature is unavailable;
- the rollback plan or the data backup is unknown.

Do not use squash, rebase, `--allow-unrelated-histories`, a forced tag update,
`--tags`/`--mirror` pushes, GitHub **Sync fork**, `migrate resolve` as a shortcut,
or `git merge -s ours` as a conflict shortcut. Do not disable hooks or checks.

## Report

State the source tag and peeled SHA, the product merge SHA, each conflict and how
it was resolved, the checks run with their results, the database steps, and every
open limit. A green `Test` in a product does not prove the full new-module path;
say which product access tests cover new modules.

All links are relative to this skill directory; the repository is three levels up.
