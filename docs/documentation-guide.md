# Writing useful documentation

Write for someone who has not discussed the feature with its author.
Help that person finish a task safely. More text does not mean better coverage.

## Before writing

1. Identify the reader, their goal and the observable result.
2. Read the full document and relevant linked instructions.
   Check its claims against current code and configuration.
3. Choose the page's purpose: a guided lesson, a task instruction, a reference,
   or an explanation. Keep these purposes distinct; link between them when useful.
   Do not create four pages when one focused page is enough.

## Write the shortest complete path

- Start task instructions with prerequisites, numbered actions and expected results.
  Use actual commands, field names and button labels. Explain placeholders.
- Keep the normal path easy to follow. Put alternatives and recovery after it;
  move detailed contracts and rationale to linked references or explanations.
- Separate operator, recipient and developer actions when their permissions differ.
  Cover UI and direct API/CLI paths only where the feature supports them.
- Explain what a result proves. Saving a request, sending an email and obtaining
  working access are different outcomes.
- Give a safe next step for relevant failures, limits and unknown results.
  State destructive consequences and when a retry is safe before the action.
- Use short, active sentences and one term per concept. Explain unfamiliar terms.
  Keep internal task codes and development history out of user instructions.
- State each rule in one authoritative place and link to it elsewhere.
  Add text only when it helps the reader finish or prevents a material mistake.

When behavior changes, follow the affected procedure from its entry point to the
expected result. Check adjacent examples and what happens after a failed step.
Remove obsolete steps, duplicate explanations and development history from the procedure.

## Verify facts and examples

- Check paths, DTOs, defaults, permissions and error codes against current code.
  Follow the OpenAPI requirements in [AGENTS.md](../AGENTS.md).
- Include a small request or response example when it is needed to complete
  the task. Link to the full contract instead of duplicating the API inventory.
- Use obviously fake credentials. Never include recovery tokens or private records.
- Distinguish tested behavior, code-checked examples and proposed checks.
  Do not describe a planned check as passed or a product limitation as a guarantee.
- Check changed links and examples. Run only checks relevant to the changed risk;
  documentation edits alone do not require a new application build or test stand.

## Keep verification results separate

Record what each check establishes:

- **Facts:** claims agree with the current implementation and configuration.
- **Reader understanding:** an independent reader can find and explain the safe path.
- **Example execution:** commands or examples were actually run in the stated environment.
- **Skill behavior:** an agent selects and applies the relevant guidance correctly.

A check can supply several results only when its observations establish each one.
Reuse earlier evidence within its actual coverage and applicable source version.
A changed instruction can require another check even when its consuming skill is unchanged.
Keep uncovered sections and unavailable execution evidence explicit.

## Maintaining agent skills

Describe the action as a user would request it, without naming a skill. Check
where the documentation map, AGENTS.md or an existing skill description leads.
Keep a direct route that already works. If an existing skill owns the action,
clarify its description or guidance. Add a skill when a recurring task has a
distinct decision that agents are likely to miss through the existing routes.

For a new skill or a material change to when it should be selected, give an
agent a realistic request without naming the skill or supplying the guide.
Record which files it opened and which decision it made. Include a nearby
out-of-scope request when the selection boundary matters.

When writing or changing a repository skill, use the documentation as its source
of current rules. Link directly to the relevant guide and require reading it
before the action. Keep the skill's trigger, decision criteria and expected result
concise; avoid copying complete procedures or volatile commands and defaults.

When a guide changes, inspect the skills that use its affected rules and links.
Update their workflow when necessary, or explain why it still applies unchanged.
Check broken links separately from changed meaning. For a material behavior change,
check the affected skill scenario, including when only the guide changed.
A matching file hash or a working link does not establish agreement in meaning.

## Review and stop

Use ordinary review for routine edits. Use an independent reader for a new or
materially changed complex journey, subject to the project's review process.
Give the reader realistic tasks and the public documentation, without author hints.
Group findings into factual errors, missing safe instructions and optional detail.
Fix the first two; do not expand the guide for every possible question.
Repeat only affected scenarios when a correction changes an important instruction.
Stop when the reader understands the main path and safe recovery, with no unresolved
material error. A reader need not answer every architecture or reference question.
Keep existing required review and verification gates; this guide adds no new gate.

Structure follows [Diátaxis](https://diataxis.fr/); procedure style follows
[Google's developer documentation guidance](https://developers.google.com/style/procedures).
