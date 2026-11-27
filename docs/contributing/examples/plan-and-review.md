# Plan, preview, review and handoff example

## Plan

**T001 — Invite a catalogue editor.** An administrator can invite a staff
member. The staff member can edit items only after accepting the invitation
and receiving the required access. Exclude bulk invitations. The author
proposes using the existing organization invitation flow. The independent
reviewer checks pending invitations and organization boundaries before reading
the proposal. The owner agrees the scope and authorizes local implementation.

**Decision.** Keep invitation delivery separate from granting access. Reuse the
existing acceptance and permission checks. This avoids a second access path.
Any new privilege needs its own review.

## Owner preview and evidence

The author supplies the actual local URL, roles, disposable test data, and the
steps to invite, accept and edit. Before acceptance, catalogue editing is denied.
After acceptance, an entitled member can edit an item. Record the owner's actual
acceptance or explicit decision to skip the preview.

- **Facts:** Trace invitation state and the permission check in the current code.
- **Execution:** Observe denial before acceptance and success for the entitled member.
- **Reader task:** Give a fresh reader the published procedure alone. Ask:
  “The email has gone out. Can the recipient edit products yet? How do you verify
  access? What do you check if access is still unavailable?” Save their answer,
  uncertainty and the document revision. Correct gaps and replay affected tasks.
- **Agent behavior:** Give a fresh agent a task without the guide's filename.
  Record which instructions it finds and which step it performs.

## Handoff and verdict

Record the task link, actual checkout and branch, base and candidate commit,
authority, preview address and ownership, observed checks, open issues and next
actor. For example, the reviewer checks the fixed revision and gives separate
product and documentation verdicts. After a correction, the author supplies the
new commit and its affected checks. Local review does not publish the work.

At closeout, record the delivered revision and keep bulk invitations as a
separate deferred item. See the [queue example](task.md#filled-queue-and-card).
