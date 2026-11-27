# Queue and task card examples

Use these fields in your existing tracker or follow the
[Git register procedure](../team-workflow.md#assign-numbers-without-a-tracker).
Keep each task in one authoritative place. Use fictional data in shared examples.

## Empty queue and card

| ID  | Task | State | Next owner | Dependency or restart condition |
| --- | ---- | ----- | ---------- | ------------------------------- |
|     |      |       |            |                                 |

- **Problem and expected result**
- **In scope and deferred**
- **Authority and next actor**
- **Task branch, base and branch status**
- **Review, delivery and decision evidence**

## Filled queue and card

| ID   | Task                          | State                    | Next owner       | Dependency or restart condition                   |
| ---- | ----------------------------- | ------------------------ | ---------------- | ------------------------------------------------- |
| T001 | Invite a catalogue editor     | Delivered                | Coordinator      | Result recorded in the delivery PR                |
| T002 | Edit catalogue items as staff | Reserved, branch pending | Catalogue author | Use the agreed T001 access contract               |
| T003 | Bulk invitations              | Deferred                 | Product owner    | Return when single invitations are in regular use |

**T002 — Edit catalogue items as staff.** A signed-in staff member with
catalogue write access can edit a published item. A pending invite does not grant
that access. The owner approved local implementation and review. Remote
delivery needs its own approval. The intended branch is
`feat/t002-catalogue-editor`. Record the actual base SHA before handing off.
The coordinator adds the branch status after creation.

**Partial acceptance.** T001 delivered single invitations and documented when
access starts. The owner deferred bulk invitations. Keep T003 with its own
acceptance result and the condition above. Link back to the accepted candidate.
