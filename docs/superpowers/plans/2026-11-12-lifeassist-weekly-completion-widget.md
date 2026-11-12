# LifeAssistOS Weekly Completion Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a truthful seven-day completion chart to the dashboard using completed tasks in the user’s local timezone.

**Architecture:** Aggregate loaded `PlanTask` records in a pure renderer model. Reuse the local timestamp-to-date helper from the core dashboard plan; the UI adds an accessible seven-bar card and no API or database change.

**Tech Stack:** React, TypeScript, existing CSS, Vitest.

**Spec:** [Weekly completion widget spec](../specs/2026-11-12-lifeassist-weekly-progress.md) and [dashboard feature set](../specs/2026-11-12-lifeassistos-dashboard-design.md).

**Dependency:** Implement after [the core dashboard plan](2026-11-12-lifeassistos-dashboard-design.md).

## Global Constraints

- Keep task data formats unchanged; derive the series from loaded task records.
- Use the supplied local `today` and `timeZone`; do not rely on the host machine’s date or timezone.
- Honor reduced motion and visible keyboard focus.

## Review Focus

- DST boundary: completed timestamps map to the correct local day when the UTC offset changes. Test in Task 1.
- Midnight boundary: events just before/after local midnight belong to different local dates. Test in Task 1.
- Empty seven-day period: return seven zero-count days, not an empty chart. Test in Task 1.
- Non-done and invalid records: ignore open/cancelled tasks and unparseable timestamps. Test in Task 1.
- Future completion timestamp: exclude dates after `today`. Test in Task 1.

---

### Task 1: Local-date completion series

**Files:**
- Create: `src/renderer/src/components/weekly-completion-model.ts`
- Modify: `src/renderer/src/components/life-dashboard-model.ts`
- Create: `tests/weekly-completion-model.test.ts`

**Interfaces:**
- Consumes: `PlanTask[]` and `localDateFromTimestamp(value: string, timeZone: string): string | null` from the core dashboard model.
- Produces: `WeeklyCompletionDay = { date: string; label: string; count: number }` and `buildWeeklyCompletionSeries(tasks: readonly PlanTask[], today: string, timeZone: string): WeeklyCompletionDay[]`.

- [ ] **Step 1: Add failing completion-series tests**

Create `tests/weekly-completion-model.test.ts` with `test_weekly_series_spans_seven_local_dates_oldest_first`, `test_weekly_series_counts_by_the_supplied_timezone_across_dst`, `test_weekly_series_keeps_zero_days_and_ignores_non_done_or_invalid_records`, and `test_weekly_series_excludes_future_completions`. Assert output has seven consecutive local date-only values ending in `today`, oldest first, and counts only `status === 'done'` tasks with valid timestamps at or before `today` in the supplied timezone.

- [ ] **Step 2: Run tests and confirm they fail**

Run: `npx vitest run tests/weekly-completion-model.test.ts`

Expected: FAIL because `weekly-completion-model.ts` does not exist.

- [ ] **Step 3: Implement the pure series builder**

Use calendar-date arithmetic over ISO date-only strings; map each completed timestamp with `localDateFromTimestamp`. Return seven buckets, including zero-count days.

- [ ] **Step 4: Run the model tests**

Run: `npx vitest run tests/weekly-completion-model.test.ts tests/life-dashboard-model.test.ts`

Expected: PASS, including DST, midnight, invalid timestamp, and local-date cases.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/weekly-completion-model.ts src/renderer/src/components/life-dashboard-model.ts tests/weekly-completion-model.test.ts
git commit -m "feat: calculate weekly LifeAssistOS task completions"
```

### Task 2: Accessible weekly bars on the dashboard

**Files:**
- Modify: `src/renderer/src/components/LifeView.tsx`
- Modify: `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: `buildWeeklyCompletionSeries(...)` from Task 1 and `LifeView`’s existing tasks/today/timezone values.
- Produces: a seven-bar dashboard card labeled with each local date and real completion count.

- [ ] **Step 1: Render the weekly completion card**

Add a `weekly-completions` card to the Life overview. Pass the supplied local date and resolved timezone to the model; render one bar per returned day with an accessible day/count label and no derived score or percentage.

- [ ] **Step 2: Style and verify the chart**

Style the seven bars with theme variables, visible zero-height bucket markers, a readable count label, and no motion under `prefers-reduced-motion`. Verify all five theme tokens keep text and bars distinguishable.

- [ ] **Step 3: Run focused tests and build**

Run: `npx vitest run tests/weekly-completion-model.test.ts tests/life-dashboard-model.test.ts tests/theme.test.ts`

Run: `npm run typecheck`

Expected: PASS with stable seven-day series and no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/LifeView.tsx src/renderer/src/styles.css tests/weekly-completion-model.test.ts
git commit -m "feat: show weekly task completions on Dashboard"
```
