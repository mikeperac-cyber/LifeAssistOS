# Recurring Tasks and Routines Spec

## Goal

Let people turn dated tasks into repeatable routines without losing completed history or changing deadlines when they reschedule one occurrence.

## Product behavior

- A task with a due date can repeat daily, weekly on one or more selected weekdays, or monthly on the same calendar day.
- Monthly repeats use the original day number and clamp to the last day of shorter months without drifting. For example, a January 31 repeat lands on February 28 and then March 31.
- An optional end date is inclusive. No occurrence is created after it.
- Completing a repeating task keeps that occurrence in history and creates the next scheduled task. Skipping an occurrence archives that occurrence and advances the routine.
- Completing or skipping the same occurrence again never creates duplicate next tasks.
- Rescheduling one occurrence changes only its due date. The recurrence rule and original scheduled date remain unchanged; the next occurrence follows the existing pattern and is after the later of today and the rescheduled due date.
- Each generated task keeps the title, notes, priority, project and workflow stage. Reminders and My Day plans are not copied.
- Recurrence works offline and remains optional. It is unavailable for subtasks; existing subtask completion remains independent.
- Changes to a repeat rule apply to the selected occurrence and future tasks generated from it. Past occurrences remain unchanged.

## Data and safety rules

- Store recurrence rule, immutable scheduled date, and stable series ID in additive nullable SQLite columns. Existing tasks must remain unchanged during migration.
- Validate frequency, weekdays, end dates, and due-date requirements at the main-process boundary and again in the local store.
- Calculate dates with date-only UTC arithmetic so daylight-saving transitions do not shift recurrence days.
- Complete/skip state change and next-occurrence creation are one SQLite transaction. A failed insert must roll back the state change.
- Create and restore compatibility checks must exercise recurrence fields and completion behavior only in their disposable database.

## Not included

Calendar synchronization, arbitrary recurrence intervals, automatic rescheduling, recurrence edits across all existing occurrences, and recurrence on subtasks.
