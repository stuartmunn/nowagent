---
type: reference
tags: [servicenow, fluent-sdk, approval-gate, template]
created: 22/08/2026
modified: 22/08/2026
---

# Approval Statement Template — Fluent SDK App

> Checked into the repo by NOW-12 (2026-08-24) as a plain copy of the source-of-truth
> document in Stuart's Obsidian vault, so future stories can read it without needing
> an Obsidian connection. If the vault copy changes, update this file to match — this
> is a mirror, not a fork.

Fixed template for the plain-English delivery statement the agent must present before
anything is applied, even to dev (per DESIGNPRINCIPLES #2). Written to mirror the native
ServiceNow form fields for each artifact type — the consultant already knows that shape
from Studio, so no new mental model needed.

## Decision options

Every statement ends with three options, not two:

* **Approve** — agent proceeds to apply the change via `now-sdk`.
* **Revise** — consultant tells the agent what's wrong in plain English; agent
  regenerates the artifact and the statement and re-presents it. No application
  happens on a Revise.
* **Reject** — agent discards the proposal. No application happens.

Nothing is ever applied on anything other than an explicit Approve. Revise can loop
more than once — no cap set for MVP; revisit if it becomes a problem in practice.

## Business Rule template

* **What & where** — artifact type, proposed name, table.
* **When it runs** — trigger point in plain English (e.g. "runs after a record is
  updated on Incident"), plus the order value and a flag if another active BR already
  exists at that order on that table.
* **Condition** — the trigger condition translated to English, not just the encoded
  query.
* **Logic** — numbered plain-English steps of what the script does.
* **Data touched** — every table/field read or written, especially anything beyond
  the triggering record.
* **Privilege flag** — BRs run server-side with elevated access; flag explicitly if
  the logic touches a table/record the requesting user couldn't normally reach, or
  bypasses something (aborts the transaction, skips workflow, etc.).
* **New vs. modifying existing** — if editing an existing BR, state what changes
  relative to current behaviour, not just what the new version does.
* **Why this type** — one line on why Business Rule and not Client Script (justifies
  the artifact-type judgement call per DESIGNPRINCIPLES #9).

### Example

```
Business Rule: "Auto-close related tasks" — Table: Incident
Runs: After a record is updated on Incident. Order: 100 (no other active BRs found at this order on this table).
Condition: Runs when the Incident's state changes to Closed.
Logic:
1. Look up all Task records related to this Incident.
2. For each related task still open, set its state to Closed and add a close note: "Auto-closed: parent incident closed."
3. Update each task record.

Data touched: reads Incident.state; reads and writes Task.state and Task.close_notes for all child tasks.
Privilege flag: updates Task records the current user may not have direct write access to — runs with elevated system privilege to do so.
New or modifying: new Business Rule.
Why Business Rule, not Client Script: needs to update related Task records server-side; a Client Script only affects the form in front of the user and can't reliably reach other records.
Approve / Revise / Reject?
```

## Client Script template

Same shape, two differences:

* **When it runs** → onLoad / onChange / onSubmit + field name (if onChange).
* **Condition** → UI type (Desktop/Mobile), isolate scope.
* **Extra security flag** — Client Scripts are cosmetic/UX only, never a security
  control. If the logic looks like it's trying to enforce something (hide a field to
  "prevent" a value, block submit to "prevent" bad data), state plainly that this does
  not stop the same change via API or import, and that a server-side control
  (Business Rule/ACL) may also be needed.

### Example

```
Client Script: "Require justification for high priority" — Table: Incident
Type: onChange, field: Priority
Condition: Desktop and Mobile UI, isolate scope: global.
Logic:
1. When Priority changes to "1 - Critical", check the Justification field.
2. If Justification is empty, show an on-screen message asking the user to complete it.

Data touched: reads Priority and Justification on the form only. No server-side records touched.
Security flag: this only nudges the user in the browser — it does not stop the record being saved via API or import with Justification still empty. A server-side check is needed if that must be enforced.
New or modifying: new Client Script.
Why Client Script, not Business Rule: this is a real-time prompt while the user is editing the form; a Business Rule can't intervene at the point of typing, only after save.
Approve / Revise / Reject?
```

## See Also

* DESIGNPRINCIPLES (not yet checked into this repo — flagged separately, see NOW-12 PR)
* RISKS
* MEMORY
