# Recurring Tasks and Routines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local recurring task routines that preserve history and repeat rules across completion, skip, and one-occurrence rescheduling.

**Architecture:** Keep date calculation pure in a small recurrence module. Persist an immutable occurrence date, normalized rule, and stable series ID in additive task columns. Advance occurrences transactionally in `PlanningStore`; carry validated rules through IPC and expose them in the existing task editor and row actions.

**Tech Stack:** Electron, React, TypeScript, Node SQLite, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-10-recurring-routines.md`

## Global Constraints

- Existing tasks and Inbox records remain readable after additive migrations.
- Recurrence needs a due date; monthly repeats retain their original day number and clamp shorter months without drifting.
- End dates are inclusive; rescheduling one occurrence does not rewrite the repeat rule.
- Completion/skip and next-occurrence creation are atomic and idempotent.
- Recurrence is optional and unavailable for subtasks.

## Review Focus

- Date arithmetic around month ends and leap days must preserve the original day number — pin with literal expected dates in `tests/recurrence.test.ts`.
- Weekday and end-date input must reject malformed values without mutation — pin with `tests/todo-planning.test.ts` and IPC tests.
- Completing late or rescheduled occurrences must not create a past or overlapping task — pin with storage behavior tests.
- Repeated completion/skip must not duplicate a series occurrence — pin with storage behavior tests.
- The recurrence probe during backup validation must mutate only its disposable database — retain the existing crafted-schema restore test and run the backup suite.

---

### Task 1: Date rules and durable occurrence lifecycle

**Files:**
- Create: `src/core/recurrence.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/core/planning.ts`
- Test: `tests/recurrence.test.ts`
- Test: `tests/todo-planning.test.ts`
- Test: `tests/backup.test.ts`

**Interfaces:**
- Produces: `TaskRecurrenceInput` (`daily | weekly | monthly`, optional selected weekdays, optional inclusive `endsOn`) and stored `TaskRecurrenceRule` (normalized input plus stable `monthDay` when monthly).
- Produces: `getNextRecurrenceDate(rule, afterDate, monthDay?) -> string | null`, using date-only `YYYY-MM-DD` values and returning the first eligible date strictly after the lower bound.
- Produces: task fields `recurrenceRule`, `recurrenceDate`, and `recurrenceSeriesId`.
- Produces: `PlanningStore.skipTaskOccurrence(id)`.

- [x] **Step 1: Write pure date-rule tests** for daily increments, selected weekdays, inclusive end dates, month-end clamping without drift, leap day, invalid weekdays, and invalid dates.
- [x] **Step 2: Run `npx vitest run tests/recurrence.test.ts` and confirm the expected missing-module/test failures.**
- [x] **Step 3: Implement and verify the pure date-rule module.**
- [x] **Step 4: Write storage tests** for additive migration, due-date requirement, generated occurrence field copying, late completion, reschedule preserving the original rule, inclusive end, skip, duplicate completion/skip, and transactional rollback when creation fails.
- [x] **Step 5: Run storage tests and confirm they fail before changing production storage code.**
- [x] **Step 6: Add nullable recurrence columns and indexes, validated rule normalization, atomic completion/skip advancement, and safe row mapping.** Keep transactions on the existing SQLite connection and avoid modifying user data during migration.
- [x] **Step 7: Update backup compatibility probing** to exercise a repeating task through completion and verify generated rows only in the temporary copy; retain the malformed-schema rejection test.
- [x] **Step 8: Run recurrence, planning, and backup tests.**

### Task 2: Validated IPC and polished task controls

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/ipc/domain-handlers.ts`
- Modify: `src/renderer/src/components/TaskEditorDialog.tsx`
- Modify: `src/renderer/src/components/TodoTaskRow.tsx`
- Modify: `src/renderer/src/components/TodoView.tsx`
- Modify: `src/renderer/src/styles.css`
- Test: `tests/todo-ipc.test.ts`

**Interfaces:**
- Consumes: `TaskRecurrenceInput`, `PlanningStore.skipTaskOccurrence`, and `PlanTask` recurrence fields.
- Produces: a `skipPlanTaskOccurrence(id)` preload method returning the standard task mutation result.
- Produces: editor fields for repeat frequency, selected weekdays, and optional end date; a row action labeled `Skip this occurrence` for open recurring tasks.

- [x] **Step 1: Write IPC tests** for valid recurrence rules, malformed rule rejection, and skip results/events.
- [x] **Step 2: Run `npx vitest run tests/todo-ipc.test.ts` and confirm expected failures.**
- [x] **Step 3: Add typed preload and main-process validation for add/update/skip.**
- [x] **Step 4: Run IPC tests and confirm they pass.**
- [x] **Step 5: Add accessible recurrence controls and repeat metadata in task rows.** Require due dates before save and keep controls hidden for subtasks.
- [x] **Step 6: Run the full test suite, typecheck, and production build.**

### Task 3: Product guidance and roadmap status

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-11-08-work-management-roadmap.md`

- [x] **Step 1: Update roadmap status and explain repeat/skip/reschedule behavior in the user guide.**
- [x] **Step 2: Review the feature diff and run `git diff --check`.**

**Workspace ruling:** Work on the current `codex/checkpoint-before-hardening` branch because it already contains the authorized, uncommitted product foundation this feature depends on. Avoid committing unrelated pre-existing changes.
