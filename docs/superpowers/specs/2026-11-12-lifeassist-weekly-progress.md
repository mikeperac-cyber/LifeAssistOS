# LifeAssistOS Weekly Completion Widget

## Goal

Add a compact seven-day completion chart based on real completed task occurrences.

## Requirements

- Export `buildWeeklyCompletionSeries(tasks: readonly PlanTask[], today: string, timeZone: string): WeeklyCompletionDay[]` from `src/renderer/src/components/weekly-completion-model.ts`.
- `WeeklyCompletionDay` is `{ date: string; label: string; count: number }`; return seven local calendar dates from `today - 6 days` through `today`, oldest first.
- Count a task only when `status === 'done'`, `completedAt` is valid, and its timestamp maps to that date in the supplied IANA time zone.
- Return zero-count days. Ignore cancelled/open tasks, invalid timestamps, and completions after `today`.
- Render seven bars with accessible date and count labels. Show counts, not a productivity score, percentage, streak, or forecast.

## Global constraints

- Keep task data formats unchanged; derive the series from loaded task records.
- Use the supplied local `today` and `timeZone`; do not rely on the host machine’s date or timezone.
- Honor reduced motion and visible keyboard focus.
