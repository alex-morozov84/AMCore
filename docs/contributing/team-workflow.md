# Work on a product based on AMCore

Use this process to take an idea through implementation, review and delivery.
Start with [project context](../../PROJECT_CONTEXT.md#team-process). It points to
the team's rules and task queue. For Git delivery and verification commands,
use [contributor instructions](../../CONTRIBUTING.md).

## Record the task and its owner

Use one queue. The owner or a designated coordinator keeps it current and agrees
priorities and dependencies. An idea in the queue still needs a decision to start.
Before work, the author records the expected result, limits, authority and who
acts next. Use an existing tracker and its IDs, or this [Git task example](examples/task.md).

### Assign numbers without a tracker

The coordinator creates the queue and first card in the product repository when
the first task starts. Record the queue branch and location in Project Context.
The suggested branch is `team/task-register`, with `team/tasks/README.md` as the
queue and permanent number ledger. Keep feature commits on their task branches.
In a public repository, published task records are public. Use an authorized
private tracker for sensitive work. Create the register branch in a separate
working copy. For example, from the product repository:

```sh
git worktree add -b team/task-register ../product-register HEAD
```

Use an unused local directory in place of `../product-register`. If the branch
already exists, use its existing authoring checkout.

1. The coordinator checks the current register commit and is its sole writer
   while assigning numbers. In one commit, add the next number and its card,
   with the author, intended branch, base commit and branch status. Start at
   `T001`, then increment the last allocated number. Retain all numbers in the
   ledger, including closed and canceled ones.
2. Hand off the register commit and task ID before creating the feature branch.
   From any linked worktree, read the shared record with
   `git show team/task-register:team/tasks/README.md`. In separate clones,
   synchronize the agreed register through authorized Git operations first.
   If the authoritative record is unavailable, wait for the coordinator's
   record before allocating another number.
3. After an interruption, check the card, pinned base and whether the named
   branch exists. Resume the same task and have the coordinator record the
   result. For a pending branch, run `git worktree add -b <branch> <directory> <base>`
   with the reserved branch, an unused directory and the recorded base commit.
   Never allocate a new number to recover the same task.

## Choose the route by impact

### Restore agreed behavior

Use one card or PR. Record the defect and expected result. The author makes
the correction, runs the smallest relevant checks and checks documentation
impact. For a visible UI fix, verify the working screen and give the owner
the address, action and expected result. Wait for another owner acceptance
only if the owner asked or the change needs a material new decision.
Have an independent reviewer check the finished candidate. If no reviewer
is available, keep that step open in the task. Self-review can support the
candidate.

### Plan a consequential change

Use this route for new user journeys, access rules, shared contracts,
architecture or data changes. The owner appoints an author and an independent
reviewer. An independent agent session can fill the reviewer role.

1. Give both a neutral brief. The author investigates existing behavior and
   options. The reviewer researches independently before reading the proposal.
2. Compare findings. The author consolidates the outcome, scope, alternatives,
   risks and checks. The reviewer checks the plan, then the owner decides
   material choices and authorizes implementation. If scope grows, pause that
   part for agreement and continue independent authorized work.
3. The author implements, checks and updates documentation. For consequential
   UI changes, agree the journey and presentation before implementation.
   Prepare a working preview with its URL, role, safe fixture data, action
   and expected result. Check affected normal, empty and failure states,
   accessibility, viewports and languages. Record what the owner accepted.
   Before final review, record acceptance of the preview or the owner's explicit
   decision to skip it.
4. The reviewer checks the whole result at the exact base and head. Record
   separate verdicts for product behavior and documentation. After fixes,
   review the affected behavior and interactions on the new revision.

See the [plan and review example](examples/plan-and-review.md).

### Run two pairs in parallel

Agree owners, a known base, shared contracts and integration order up front.
Give each task one author at a time, its own branch and working copy, and a
separate [managed stand and database](../operations/local-stands.md) when it
needs runtime. A reviewer who works concurrently checks a fixed commit in
a separate checkout. Avoid touching another task's Git index or services.

Overlapping migrations or API semantics can require ordering even when files
differ. Put the dependency in the queue. When the first change lands,
synchronize the second task and retest affected interactions. To transfer work,
give the next contributor the task, authority, checkout, branch, base/head,
observed checks, stand ownership, limits and next action. The new contributor
uses that record to continue.

## Verify the result and the instructions

Start with the [smallest test that proves the risk](../operations/adding-tests.md).
Retain the first failure and distinguish an environment problem from a product
defect. When replacing a test, record the retained witness, the controlled
fault it detects and any lost coverage. A mock browser lane does not prove
real service integration.

Use the [documentation guide](../documentation-guide.md) to identify the
reader, entry point, expected result and recovery path. Check the facts
against code, inspect links and run applicable examples. Check OpenAPI,
environment examples and skills when their contracts change. Record what
you ran separately from what you inspected.

For a new or materially rewritten instruction to act, or a procedure involving
security, an irreversible step or a choice between paths, the author arranges
a fresh reader. Give that reader the intended public or authorized materials
and tasks from discovery through recovery. Keep author discussion and answers
out of the exercise. Ask the reader to explain actions, expected results and
uncertainty without executing commands. Save the original response and the
revision. Correct material gaps and repeat affected scenarios. The reviewer
checks the evidence and final text. For changed agent instructions, observe
a fresh agent acting on them as a separate check.

If product work reveals a shared problem or capability, use
[Report a finding to AMCore](../../CONTRIBUTING.md#report-a-finding-to-amcore).
Keep the product task in its own queue.

## Deliver and close

Install and [verify Git hooks in the authoring checkout](../operations/ci-security.md#local-commit-hooks-scope-and-limits).
Use an isolated checkout to confirm that Git calls the message hook and rejects
an invalid message. The inherited commit hook also restricts attribution
trailers. Choose checks by risk and compare CI evidence with the exact revision.
When the base changes, revisit affected interactions and recheck them.
Apply the declared Git delivery mode and verify live protections separately.

Keep permissions for push, PR, merge, release and deployment distinct. After
delivery, verify the resulting revision. The author records evidence and
proposes updates to the queue. The coordinator closes the delivered scope and
keeps any remainder with a reason, owner, restart condition and link. Retain
significant decisions. Clean up only resources owned by this task, following
the agreed data retention and [stand closeout procedure](../operations/local-stands.md#closeout-before-removing-a-checkout).

Assign ownership for ordinary, major and urgent dependency updates. Use the
existing [CI and security guide](../operations/ci-security.md). Keep product
release notes separate from AMCore's history. For release and deployment,
use the [contributor guide](../../CONTRIBUTING.md) and [deployment guide](../operations/deployment.md).
For updating the starter, preserve source ancestry and applied migrations
as described in the [fork guide](../operations/updating-a-fork.md).
