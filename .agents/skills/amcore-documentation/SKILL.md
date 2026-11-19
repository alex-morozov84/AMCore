---
name: amcore-documentation
description: Write, restructure, or review AMCore public documentation, including the root README and documentation changes accompanying code. Use in AMCore and downstream forks. Excludes generic prose and private task logs.
---

# AMCore documentation

Apply the current public [documentation guide](../../../docs/documentation-guide.md).
Read it before writing or reviewing, including when this skill was used earlier
in the session. This skill selects the work; the guide owns the writing rules.

## Establish the document's job

1. Read the project's `PROJECT_CONTEXT.md` and applicable repository instructions.
   Identify whether the documentation serves AMCore or a downstream product.
2. Identify the reader, their task and the result they must observe.
   Read the full page and relevant linked instructions before proposing changes.
3. Find the authoritative home through the [documentation map](../../../docs/README.md).
   Reuse an existing guide when it already owns the subject.
4. Check current source and configuration for claims that affect the task.
   Report unresolved contradictions instead of presenting either text as a guarantee.
   Do not change product behavior merely to make a documentation claim true.

## Choose the smallest complete change

For a root README, help visitors judge the project and find their first supported
result. Keep essential prerequisites and safety cues. Link to owning guides for
operational procedures and detailed contracts. Do not turn the README into a
second documentation map or remove necessary instructions just to shorten it.

For a procedure, use the guide's task-writing rules. Keep normal, alternative and
recovery paths discoverable. Distinguish actors when they need different authority.

For a reference or explanation, preserve current contracts and useful context.
Remove development diaries from current instructions; keep release history in its
existing home. Do not strip useful safety or compatibility explanations as history.

For a factual correction, change the affected claim and its dependent examples or
links. Do not rewrite adjacent guides without a concrete reader problem.

When moving text, name its destination first. Check that readers can still find
it and that existing links or anchors remain valid. A shorter source page alone
is not evidence that the move succeeded.

## Verify and report the actual result

Use the guide's separate evidence requirements for facts, reader understanding,
example execution and skill behavior. Reuse prior proof only for the covered
instructions and applicable source/environment. Missing proof remains missing.

Select checks for the changed risk using the project's existing verification
instructions. A prose change does not itself require running every application
suite. A command that was read or inspected was not thereby executed.

For reader exercises, provide only the agreed public material and realistic
tasks, without author history, diagnosis or expected answers. Follow the project's
reader-isolation and approval requirements. A reader does not replace review or
execute examples. Do not declare approval from your own assessment of its answers.

If a guide or workflow is being changed by another assigned task, preserve its
scope and record the dependency. Reuse its final text and evidence when available;
check only uncovered obligations and affected links.

## Keep related skills current

Follow [Maintaining agent skills](../../../docs/documentation-guide.md#maintaining-agent-skills).
Keep useful decision criteria here; keep volatile commands, defaults and complete
procedures in the owning guide. When a guide changes, inspect its consuming skills.
A skill may remain unchanged when its workflow still applies; explain why.

Report the documents changed, factual sources checked, checks actually run,
reused evidence and remaining limits. Do not publish, execute external procedures
or expand permissions merely because a document or skill describes those actions.

All links are relative to this skill directory; the repository is three levels up.
