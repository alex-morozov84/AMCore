# Create and update a product from AMCore

Use this guide to keep your product changes while adopting selected AMCore releases.
An **upstream** is the original AMCore repository. Your **product** has its own repository and release policy.
A **merge commit** records both histories, so Git can recognize changes already integrated.

> **No supported starting release exists yet.** The first supported base will be a new
> pre-beta tag after this contract is verified. Older tags, templates, ZIP copies and
> products generated with the removed scaffolding are not supported starting points.
> Do not substitute an old tag for the placeholders below. Commit-based experiments
> do not establish release support.

A disposable independent-copy product completed two updates with full PR and post-merge CI.
Its test user and order survived; fresh-database replay and runtime checks also passed.
An independent readability check is pending.
The private flexible route and GitHub Fork-specific behavior are not rehearsed.
Do not treat the examples as evidence of a tested production upgrade.

```text
Supported AMCore tag -> product update branch -> resolve and validate
                    -> product PR with merge commit -> separate deployment
```

## Choose the repository and protection mode

A fork of public AMCore is public; its visibility cannot independently become private.
If your product may become closed later, start with an independent copy.

| Your intent                                | Create the repository                                                | Result                                                               |
| ------------------------------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Open product                               | Use the GitHub **Fork** button, then clone your Fork                 | Connected to AMCore's public fork network and counter                |
| Closed product, or possible future closure | Clone AMCore, then push the product branch to a new empty repository | Independent copy with full Git history; not counted as a GitHub fork |

Never use a template, ZIP or a history reset for the merge-based path.
Never mirror-push into an existing repository. Each product owns its settings and credentials.

| Repository capabilities                                                          | Mode and setup                                  | Limits                                                                           |
| -------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------- |
| Public with the required security features                                       | `strict`; run setup with `--fork-updates`       | Verify live settings and successful required checks                              |
| Eligible private organization with Code Security, Secret Protection and rulesets | Same `strict` profile                           | Verify actual licenses and API state; Pro alone does not supply the full profile |
| Private without all those features                                               | `flexible`; configure available checks manually | Not rehearsed; no guarantee equivalent to the full profile                       |

For flexible private products:

1. Keep merge commits enabled for updates. Keep available tests, Gitleaks, OSV and dependency alerts.
2. Remove unavailable `Analyze` and `Dependency review` from required checks, where configurable.
3. Disable unsupported workflows in GitHub's Actions UI or with `gh workflow disable WORKFLOW -R OWNER/PRODUCT`.
   Use `codeql.yml` or `dependency-review.yml` for `WORKFLOW` only when that feature is unavailable.
   Keep the files; deleting them creates future merge conflicts. Recheck workflow state after updates.
4. Record missing scanning, push protection and enforcement in the product contributor guide.
   Free private repositories lack branch/tag rulesets. Pro/Team can supply rulesets without the security add-ons.
   Require the available checks where supported. Otherwise review and tag discipline depend on your team.
5. Budget CI before enabling it. Inherited jobs may exceed your private account's included allowance.
   Select supported whole workflows through their Actions enable/disable state,
   as in step 3, and align required checks with that selection. Do not select
   individual `Test` dependencies by removing or skipping them in `ci.yml`.
   Script contracts locks that dependency set and the guarded leaf commands
   and conditions; `Test` rejects skipped dependencies.
   Further coverage reductions need an explicit product policy and corresponding
   contract changes; changing required checks alone does not change these contracts.
   **No runner-minute estimate is available yet.** Record minutes per job and total per update PR,
   including retries and follow-up push runs. Public standard-runner billing of zero is not a private cost estimate.

The starter test suites have been verified only with the default served locales
(`en` and `ru`, default `en`) and Console settings (`path`, alias `admin`).
A product that changes these settings may need to adapt inherited tests and their
selection. This verification does not establish coverage for other settings.

An initialized product's **Test capability extension** job prints a warning in its
log and step summary, then succeeds without running the disposable fixture.
Exactly one canonical downstream Mode line in `PROJECT_CONTEXT.md` selects this
behavior. The fixed starter patch cannot follow arbitrary product edits, so this
warning is expected. Keep the job: removing it breaks Script contracts.
Inherited tests still run, but green `Test` no longer proves the complete
new-module extension path on product code. Test your own modules against PostgreSQL;
see the [required access cases](../auth/capability-catalogue.md#extend-a-downstream-product).

Do not run strict setup to bypass a missing license. The combined repository-security request can fail;
setup does not silently downgrade protections. Existing scripts are not proof of live GitHub enforcement.
See [CI security](ci-security.md#strict-security-setup-after-forking).

## Initialize once, from the supported source tag

Prerequisites: Git, the pinned Node/pnpm toolchain, a clean clone, and the supported release's exact tag and full commit SHA.
Obtain tag/SHA from the AMCore release, inspect its notes, and stop if they disagree with fetched objects.
Use fake/example values only after replacing them with your own repository and the actual supported release.
Creating repositories, pushing code and changing settings require the product owner's permission.

1. Set the remotes. `origin` always means the product; `amcore` always means AMCore.
   For an independent copy, clone AMCore normally, rename `origin` to `amcore`, then add your empty destination as `origin`.
   For a GitHub Fork, clone your Fork and add `amcore`. Inspect `git remote -v`; never overwrite a mismatched remote.

   ```sh
   # Independent copy, inside the new AMCore clone:
   git remote rename origin amcore
   git remote add origin https://github.com/OWNER/PRODUCT.git
   # GitHub Fork instead, inside your Fork clone:
   # git remote add amcore https://github.com/alex-morozov84/AMCore.git
   ```

2. Inspect Fork tags on `origin` with `git ls-remote --tags origin`; record whether source tags were copied.
   Official Fork documentation does not guarantee that behavior. In BOTH Fork outcomes, use `product/v*` for product releases.
   Do not delete source tags on the remote. Independent copies may use their own `v*` tags after step 5.

3. Fetch the chosen tag under its original name **before** initialization, including when a Fork has no tags.
   This keeps the initializer's provenance value exact. The commands contain placeholders, not a real release:

   ```sh
   SOURCE_TAG='vX.Y.Z'
   SOURCE_SHA='REPLACE_WITH_VERIFIED_FULL_COMMIT_SHA'
   git -c remote.amcore.tagOpt=--no-tags fetch amcore "refs/tags/$SOURCE_TAG:refs/tags/$SOURCE_TAG"
   git rev-parse "refs/tags/$SOURCE_TAG"
   git rev-parse "refs/tags/$SOURCE_TAG^{commit}"
   test "$(git rev-parse "refs/tags/$SOURCE_TAG^{commit}")" = "$SOURCE_SHA"
   git switch -c product-start "refs/tags/$SOURCE_TAG"
   git describe --tags --exact-match
   ```

   Stop on any failure, existing mismatched tag, or describe output other than the source tag.
   Record both the tag-object SHA and peeled commit SHA. Never force-update a tag.
   For a Fork, inspect `origin/main`: it must equal the selected source commit for this initial delivery.
   If it already contains later commits, do not rewind it. Use a supported tag matching that head or the independent-copy route.

4. Follow [product initialization](../product-admin/adoption.md#initialize-a-clean-product) to prepare dependencies and run `pnpm init:brand`.
   Set product name, purpose, description, workflow and upstream sync policy. Declare reviewed release merges as the sync policy.
   Run initialization before any product commit or tag namespacing. Verify `initialized_from_amcore_version` equals `SOURCE_TAG`.
   Preserve that value thereafter; it describes the starting point, not the latest update.
   Resolve verification failures using the [initializer recovery guide](../frontend/brand-theme-and-tokens.md#recover-from-a-failure).
   Commit the inspected initialization changes only after the value and checks are correct.

5. **Independent copy only, before creating any product release tags:** list all copied `v*` tags,
   then delete those local refs. Do not reuse this deletion step on an established product.

   ```sh
   git tag --list 'v*'
   # After verifying these are only copied AMCore tags:
   git tag --list 'v*' | while IFS= read -r tag; do git tag -d "$tag" || exit; done
   ```

   Keep non-`v*` source tags local if needed. Fetch upstream release tags into their own namespace using the next section.
   A namespace is a name prefix: `amcore/v1.2.3` cannot collide with product `v1.2.3`.
   Do not use `git describe` as an upstream-version detector after namespacing; compare recorded object/commit SHAs.

6. Deliver initialization to the product, preserving the selected source as an ancestor.
   For an empty independent destination, push the explicit product branch to `main` (`git push origin product-start:main`).
   For a Fork, push `product-start` and open a PR into its matching `main`.
   Configure the selected protection mode and verify required CI before subsequent updates.
   Push only explicitly selected branches or product tags, never `--tags` or `--mirror`.

## Prepare every clone, including an agent clone

Remote configuration and the CLI default repository do not travel with Git commits.
Read `Canonical upstream` and product identity in `PROJECT_CONTEXT.md` before configuring anything.
Stop if the identity is still `upstream-starter` in a product or either remote points elsewhere.

```sh
git remote -v
# Add amcore only if absent, using the verified Canonical upstream URL:
# git remote add amcore https://github.com/alex-morozov84/AMCore.git
git config remote.amcore.tagOpt --no-tags
git fetch amcore 'refs/tags/v*:refs/tags/amcore/v*'
gh repo set-default OWNER/PRODUCT
gh repo set-default --view
```

There is deliberately no `+` in the tag refspec: a moved tag must stop the update.
Fetch output must name the expected upstream; verify tag and peeled commit SHAs against release records.
Apply the repository's approval rules before CLI network access. UI users must also verify the product as the PR base repository.

For eligible strict products, initialize `PROJECT_CONTEXT.md` first, then run:

```sh
bash scripts/setup-repo-security.sh --fork-updates
```

This enables merge and squash, disables rebase, and removes required linear history from the rendered main ruleset.
Other required checks and protections remain. Feature PRs may squash; source-update PRs must preserve merge parents.
The script cannot enforce which method belongs to each PR. An unflagged rerun warns, then restores squash-only policy.
Always repeat the flag when reconciling this profile. AMCore itself remains squash-only.

For a Fork's `product/v*` releases, add a separately named tag ruleset matching `refs/tags/product/v*`,
with tag update and deletion blocked. The script's existing ruleset covers only `refs/tags/v*`.
Verify both after reruns. Align product release/deployment tag triggers and environment restrictions with the chosen product prefix.
Where rulesets are unavailable, document the absence of server enforcement.
Check live settings and Actions before claiming success. Public Fork schedules start disabled;
confirm Actions enablement and Dependabot state during the first actual run.

## Update to a selected release

1. Start on clean, current product `main`. Verify remotes, CLI default and the target tag/SHA.
   Read root `CHANGELOG.md` and all intervening upstream release instructions, including mandatory intermediate steps.
   Record the starting product commit and a rollback/data plan before changing source.
2. Fetch upstream tags with the namespaced refspec above. Inspect the selected source notes directly:

   ```sh
   TARGET_TAG='vX.Y.Z'
   git show "refs/tags/amcore/$TARGET_TAG:CHANGELOG.md"
   git rev-parse "refs/tags/amcore/$TARGET_TAG^{commit}"
   git merge-base HEAD "refs/tags/amcore/$TARGET_TAG^{commit}"
   git switch -c update/amcore-example
   git merge --no-ff --no-commit "refs/tags/amcore/$TARGET_TAG^{commit}"
   ```

   Replace the example branch with an unused name. Stop if histories are unrelated; never use `--allow-unrelated-histories`.
   A conflict is a review point. An already-integrated target needs no new integration commit.

3. Resolve each conflict using the recipes below. Review the complete staged diff, including cleanly merged changes.
   Keep hooks enabled; they run at the commit in step 5.
   Pinned lint-staged 17.6.0 selects added, copied, modified or renamed staged paths that differ from BOTH parents.
   A path taken whole from one parent is not selected, so a merge can select nothing.
   Combined edits, automatic or manual, can be selected and rewritten. A passing hook does not replace full validation.
4. Install dependencies from the merged lockfile before running checks or committing.
   Run the target release's checks plus product tests and affected deployment/data checks.
   At minimum follow [contributor checks](../../CONTRIBUTING.md#before-submitting-a-pr).
   Verify product permissions, translations, dependencies and chosen locale/Console/admin placement.
   A successful textual merge does not prove the result works. Rehearse database changes as described below.
5. Save the reviewed index tree, then commit and compare the committed tree with that saved tree:

   ```sh
   BEFORE_TREE="$(git write-tree)"
   git commit -m 'chore: update amcore' && git diff "$BEFORE_TREE" HEAD
   ```

   If a hook fails, stop here: the merge and your conflict resolution remain in progress.
   Inspect the index and working tree, fix the cause, and repeat this step after the affected checks pass.
   If hooks rewrite files and the commit succeeds, those edits are already in the commit; the staged diff can be empty.
   Review the saved-tree comparison and rerun affected checks before pushing. Investigate any unexpected change.
   Then push the explicit branch and open the PR in the **product**:

   ```sh
   git push -u origin update/amcore-example
   gh pr create -R OWNER/PRODUCT --base main --head update/amcore-example
   ```

   Check the resulting PR URL and base repository before review. Require checks on the reviewed head.
   Deliver with a **merge commit**, never squash or rebase, in strict, flexible and custom modes alike.
   Use `-R OWNER/PRODUCT` on CLI delivery commands too. Squashing loses source ancestry and can repeat old conflicts.

6. After delivery, fetch product `main` and prove the selected source remains its ancestor:

   ```sh
   git fetch origin main
   git merge-base --is-ancestor "refs/tags/amcore/$TARGET_TAG^{commit}" origin/main
   ```

   Exit 0 proves ancestry only. Record source tag/SHA, product merge SHA, checks and required deployment actions in the product PR.
   Deploy separately through [deployment and migrations](deployment.md); source merge does not deploy or undo SQL.

Do not use GitHub **Sync fork / Update branch** for this product workflow.
It does not supply the selected-tag update branch, validation and review sequence above.
Exact behavior on a diverged Fork with its rulesets remains unverified.
Taking every tag does not guarantee fewer conflicts. You may skip tags after reading their instructions;
obey mandatory intermediate releases or migrations. Break a difficult update into smaller steps only when useful.

## Resolve common conflicts

| Area                      | Preserve and verify                                                                                                                                                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependencies and lockfile | Combine intended manifest requirements, resolve with the pinned pnpm version, inspect the lock diff, then verify frozen install. Never blindly take one lockfile side                                                                           |
| Messages                  | Keep upstream and product keys in every catalogue. Separate product namespaces may help but do not guarantee conflict-free merges                                                                                                               |
| Composition and exports   | Preserve product registrations and inspect upstream API changes. Type errors help; a clean merge can still remove a used export                                                                                                                 |
| Prisma                    | Preserve shared migration files; inspect both schema changes and SQL effects. Different filenames can still create the same column                                                                                                              |
| Identity and settings     | Preserve product identity, original provenance, workflow policy, locales, Console mode/alias and product-admin host/path. Regenerate edge mappings from the retained settings                                                                   |
| README and releases       | Keep product identity/introduction in README. Leave root CHANGELOG.md AMCore-owned and unedited by the product; put product notes in a separate named file such as PRODUCT-CHANGELOG.md. Product package version is not an upstream sync marker |

Keep product contributor instructions and the PR template aligned with the separate product notes file.
Do not resolve an ambiguous identity, permission or data conflict by taking an entire side.

## Preserve database history and rehearse data changes

Never edit, delete, rename or squash a migration after it reaches shared `main`/a release,
or after applying it to a database you intend to retain. Unshared, unapplied work may still be corrected.
The required **Script contracts** PR job compares existing migration paths/blobs with the merge commit's first parent.
It rejects changes/removals and permits additions. It requires the default merge checkout with two parents and depth two.
`HEAD` must equal `GITHUB_SHA`; an absent parent/tree fails. Push-only runs do not perform this history check.
It does not detect two newly added migrations creating the same object or prove that SQL is safe.

Before rollout, use owned disposable databases and a verified backup/restore procedure:

1. Upgrade a seeded database representing the old product, including its product migrations.
   Exercise both `migrate deploy` and the local `migrate dev` path on separate disposable copies when relevant.
   Include the case of an older-named pending upstream migration after a later-named product migration.
   Observe shadow-database replay, statuses and checksums. Stop on unexpected drift/reset prompts; never accept reset automatically.
2. Replay the full combined history into a fresh database. Compare its schema, constraints/indexes and preserved data invariants with the upgraded database.
   Inspect migration ledger names/checksums separately; timestamps need not match.
3. Compare EACH database with the merged Prisma schema using the installed version's `prisma migrate diff` command.
   Check CLI help for that version. Two databases can agree and both disagree with the intended schema.
4. Stop before application rollout on any migration failure. A duplicate table/column can fail even when Git merged cleanly.
   Restore a known-good snapshot and verify data and ledger using the [recovery runbook](backup-restore.md).

Disposable fixtures at the pinned Prisma version exercised fresh and upgraded databases,
out-of-order migration application, `migrate dev`, failure on a duplicate column and chained backup restoration.
These checks cover the fixtures, not your product's migrations, production volume or custom grants.
Repeat the relevant scenarios for your product before rollout.
Use product-owned tables/fields where suitable, but prefixes do not prove collision safety.
A later compensating migration cannot repair a fresh replay that fails before reaching it.
`migrate resolve` changes bookkeeping, not data: never mark an upstream migration applied merely because one column exists.
Any forward reconciliation needs proof of the complete effects, including partial failure, on BOTH fresh and upgraded databases.
Until that proof exists, stop and use restore/manual expert reconciliation. No automatic reset, rebaseline or shared-history rewrite.

## Abort, recover, or take a partial fix

- Before committing an unresolved merge, use `git merge --abort` from the recorded clean starting point.
- For an unpublished committed integration, preserve the branch and evidence; resume from the recorded pre-update commit on a new branch.
  Do not rewrite a shared branch. For deployed data, follow database recovery; a Git revert does not undo SQL.
- After accidental squash delivery, stop. Establish exactly which source changes were integrated and retained.
  An expert may record ancestry with `git merge -s ours` only after reviewing proof of complete prior integration.
  It brings in no source content: an omitted security fix remains omitted. It is never a conflict shortcut.
- For an urgent cherry-pick/manual port, inspect dependencies and migration prerequisites, record the source SHA, and test the adapted fix.
  This is partial adoption, may add future conflicts, and does not claim the entire release is integrated.

Agents stop on unrelated history, moved/unverified tags, wrong PR target, ambiguous security/data conflicts,
unknown rollback, missing checks or unavailable entitlements. Do not bulk-select a side or invent a repair.
GitHub Fork tag copying and same-account self-fork availability remain unverified here;
the copy rehearsal cannot establish Fork-only state. Check an authorized second account/organization when needed.

## Beta compatibility and release notes

During beta, incompatible changes to documented integration contracts receive explicit notice and instructions, not an immutability guarantee.
These contracts include backend extension recipes, documented product-admin/headless APIs, HTTP/auth/shared types used by those recipes,
settings/env schemas, toolchain commands and deployment inputs. Other source paths/exports have no stability promise merely because a barrel exports them.
Changes affecting authorization, stored data, queues, storage keys, host/session/locale routing or security checks also need an action note.
Extension-fixture changes trigger review; they do not automatically prove a breaking public change.

Use this note form: **Breaking for <affected consumer>**; old/new behavior; required action and order;
verification; data and rollback limits. Read each note before choosing the update target.
Security fixes target the latest published minor only; no older-minor backports or SLA are promised.
See [security policy](../../SECURITY.md). A manual port is product-owned, not upstream support for an older line.
AMCore remains 0.x until a deliberate stability decision; no 1.0 date is promised.

There is no beta update bot or codemod. Reconsider codemods when a real product needs repetitive, deterministic edits
that type errors/manual instructions cannot adequately guide, and customized fixtures demonstrate a benefit.
That decision does not imply reuse of any retained initializer engine.

## Optional thanks

If AMCore helps your project, consider giving it a star on GitHub.
An optional text badge needs no image or tracking service:

```markdown
[Built with AMCore](https://github.com/alex-morozov84/AMCore)
```

The badge is not required, implies no endorsement, and does not replace the MIT copyright/license notice.
Agents never star AMCore or add a badge to a product on their own.

## Platform references

[GitHub Fork visibility](https://docs.github.com/en/pull-requests/reference/forks),
[Fork creation](https://docs.github.com/en/pull-requests/how-tos/work-with-forks/fork-a-repo),
[workflow disablement](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows),
[CLI default repository](https://cli.github.com/manual/gh_repo_set-default),
[ruleset availability](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets),
[security feature availability](https://docs.github.com/en/get-started/learning-about-github/about-github-advanced-security),
[Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
Platform availability can change; verify it for the destination before setup.
