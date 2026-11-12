# LifeAssistOS Core Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give LifeAssistOS a polished, data-backed dashboard with the Today summary, agenda, focus queue, goal and project cards, routine launch tiles, and upcoming life-admin items from the selected ten-feature set.

**Architecture:** Keep the existing React/Electron shell, database, and task APIs. Update the Midnight tokens and shared shell, promote the Life overview to Dashboard for new users, and derive summary, focus, project, goal, schedule, routine, and upcoming cards from the records already loaded by LifeView. Weekly completion, pinned notes, and layout customization have independent plans and follow this core dashboard.

**Tech Stack:** Electron, React, TypeScript, existing CSS design tokens, Vitest.

**Spec:** [Core dashboard spec](../specs/2026-11-12-lifeassist-dashboard-core.md), within the [ten-feature dashboard direction](../specs/2026-11-12-lifeassistos-dashboard-design.md).

**Plan order:** Complete this plan first, then [weekly completion](2026-11-12-lifeassist-weekly-completion-widget.md), [pinned notes](2026-11-12-lifeassist-pinned-notes.md), and [dashboard customization](2026-11-12-lifeassist-dashboard-customization.md) in that order.

## Global Constraints

- Preserve the five theme IDs and existing route IDs.
- Do not change task, goal, project, routine, calendar, journal, or assistant data formats in this subproject.
- Use only stored task, goal, project, routine, and imported calendar data; add no fabricated identity or metrics.
- Keep the app usable at `880×620`; below `700px` content width, use one dashboard column without horizontal scrolling.
- Honor `prefers-reduced-motion` and visible keyboard focus.

## Review Focus

- Empty workspace: use zero counts and action-oriented empty states, with no fabricated trend. Test in Task 3.
- Completed, cancelled, or recurring tasks: counts include only open/current planned work; local completion count uses `completedAt`. Test in Task 3.
- Tasks linked to many projects or no projects: project cards show each open project once and ignore projects without open tasks. Test in Task 3.
- Dates near midnight or daylight-saving changes: completed-today and upcoming events use local dates consistently. Test in Task 3.
- Long names and narrow viewports: labels remain legible, controls reachable, and cards stack without horizontal scrolling. Verify in Task 4.

---

### Task 1: Midnight theme tokens

**Files:**
- Modify: `src/renderer/src/styles.css`
- Test: `tests/theme.test.ts`

**Interfaces:**
- Consumes: Existing `APP_THEMES` IDs and CSS variables.
- Produces: Midnight tokens `--bg #0b0910`, `--panel #15121b`, `--panel-2 #201b29`, `--accent #8b5cf6`, `--amber #f4c95d`, `--pink #ec4899`, with matching RGB tints and high-contrast `--accent-ink`. Other themes use pink values `light #ba327b`, `forest #ed78a2`, `violet #f28aca`, and `blueprint #ff82b8`.

- [ ] **Step 1: Add a failing Midnight palette test**

Add `test_midnight_uses_the_ink_and_violet_dashboard_palette` in `tests/theme.test.ts`. Assert the exact Midnight values above, each RGB token matches its hex token, and the violet focus/action color has at least 3:1 contrast against `--bg` and `--panel`. Add `139,92,246` and `236,72,153` to the known palette channels; validate the `pink`/`pink-rgb` pair across all five themes.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/theme.test.ts -t "test_midnight_uses_the_ink_and_violet_dashboard_palette"`

Expected: FAIL because Midnight still uses teal and no shared pink token exists.

- [ ] **Step 3: Implement the shared palette tokens**

Update the root Midnight tokens and add theme-specific `--pink`/`--pink-rgb` pairs in `src/renderer/src/styles.css`. Preserve all five theme IDs and use RGB variables for translucent tints.

- [ ] **Step 4: Run theme tests**

Run: `npx vitest run tests/theme.test.ts`

Expected: PASS, including existing focus contrast and semantic-tint checks.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/styles.css tests/theme.test.ts
git commit -m "style: add LifeAssistOS violet dashboard palette"
```

### Task 2: Dashboard navigation and Create action

**Files:**
- Modify: `src/renderer/src/navigation.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Modify: `src/renderer/src/styles.css`
- Test: `tests/navigation.test.ts`

**Interfaces:**
- Consumes: Existing view IDs, route normalization, sidebar state, and `QuickCaptureDialog`.
- Produces: `DEFAULT_VIEW = 'life'`; `VIEW_META.life.label = 'Dashboard'`; header **Create** opens the existing quick-capture dialog. Existing IDs and keyboard shortcuts remain unchanged.

- [ ] **Step 1: Add a failing navigation default test**

In `tests/navigation.test.ts`, import `DEFAULT_VIEW`, set view order to `['life', 'tasks', 'assistant', 'review', 'projects', 'settings']`, and add `test_new_install_defaults_to_dashboard_without_remapping_saved_routes`. Assert `DEFAULT_VIEW === 'life'` and `normalizeView` preserves `tasks`, `projects`, and `settings`.

- [ ] **Step 2: Run navigation tests and confirm they fail**

Run: `npx vitest run tests/navigation.test.ts`

Expected: FAIL because the current default is Tasks and navigation begins with Tasks.

- [ ] **Step 3: Update labels, order, and default**

Set the Life label to Dashboard, set `DEFAULT_VIEW` to `life`, and use the specified view order in `navigation.ts`. Leave normalization of unknown or corrupt saved values falling back to `tasks`, so valid saved routes remain valid.

- [ ] **Step 4: Move quick capture into the header**

In `App.tsx`, add **Create** beside the existing command trigger and bind it to `setQuickCaptureOpen(true)`. Remove the duplicate capture button and callback prop from `Sidebar.tsx`; retain `Ctrl+Shift+K` and `Ctrl+K` handling.

- [ ] **Step 5: Style shell, navigation, and header controls**

In `styles.css`, set the near-black shell, compact icon-led navigation, violet active state, restrained radial `--glow-accent`, and visible focus. Restore the radial body background in the later LifeAssistOS override.

- [ ] **Step 6: Run navigation tests**

Run: `npx vitest run tests/navigation.test.ts`

Expected: PASS with route normalization and shortcut tests intact.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/navigation.ts src/renderer/src/App.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/styles.css tests/navigation.test.ts
git commit -m "feat: make LifeAssistOS Dashboard the new-user home"
```

### Task 3: Data-backed dashboard cards

**Files:**
- Create: `src/renderer/src/components/life-dashboard-model.ts`
- Modify: `src/renderer/src/components/LifeView.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles.css`
- Test: `tests/life-dashboard-model.test.ts`

**Interfaces:**
- Consumes: `PlanTask[]`, `TaskProject[]`, `LifeGoal[]`, `RoutineTemplate[]`, `JournalEntry[]`, and `CalendarEvent[]` already loaded by `LifeView`.
- Produces: `localDateFromTimestamp(value: string, timeZone: string): string | null` and `buildDashboardSummary(input: { tasks: readonly PlanTask[]; projects: readonly TaskProject[]; todayEvents: readonly CalendarEvent[]; upcomingEvents: readonly CalendarEvent[]; today: string; timeZone: string }): DashboardSummary`. `DashboardSummary` contains `plannedTasks: PlanTask[]`, `focusTasks: PlanTask[]`, `dueTodayCount: number`, `completedTodayCount: number`, `todayEventCount: number`, `projectCards: Array<{ project: TaskProject; openTaskCount: number; nextTask: PlanTask }>`, `upcomingTasks: PlanTask[]`, and `upcomingEvents: CalendarEvent[]`.

- [ ] **Step 1: Add failing summary tests**

Create `tests/life-dashboard-model.test.ts` with `test_dashboard_summary_uses_open_tasks_for_planning_and_due_counts`, `test_dashboard_summary_uses_local_completed_date`, `test_dashboard_summary_returns_one_card_per_project_with_open_work`, `test_dashboard_upcoming_includes_today_through_six_days`, and `test_dashboard_summary_returns_empty_cards_for_empty_data`. Assert planned tasks sort by `dayOrder`, focus uses the first three, cancelled tasks are excluded, project cards only include open tasks and select the next task by high priority then earliest due date then creation date, and `timeZone` controls the completed-today date.

- [ ] **Step 2: Run model tests and confirm they fail**

Run: `npx vitest run tests/life-dashboard-model.test.ts`

Expected: FAIL because the model module does not exist.

- [ ] **Step 3: Implement the pure dashboard model**

Implement `buildDashboardSummary` in `life-dashboard-model.ts`. Sort the open My Day focus tasks by `dayOrder`, compute due-today and completed-today counts from current stored tasks, produce one project card per project with open tasks, and select upcoming due tasks/events from `today` through `addDays(today, 6)`.

- [ ] **Step 4: Add next-seven-day calendar data to LifeView**

In `LifeView.tsx`, request calendar events from the local date through `addDays(today, 6)` alongside existing requests; pass the timezone from `Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'` to the model. Keep the existing selected-date Calendar tab query intact.

- [ ] **Step 5: Render Today, focus, goals, projects, routines, and upcoming cards**

Build the summary strip, agenda, first-three focus queue with existing completion IPC, goal rings, project cards, routine launch tiles, and upcoming-life-admin card in `LifeOverviewTab`. Goal rings use completed divided by open-plus-completed linked tasks; cancelled tasks do not contribute. Reuse the existing recent-note card until the pinned-notes subproject replaces it.

- [ ] **Step 6: Style the dashboard grid**

In `styles.css`, apply rounded shared cards, thin borders, violet action buttons, amber/pink semantic accents, legible headings, and useful empty states to the new dashboard widgets. Keep the summary visible first and the grid two columns above the narrow breakpoint.

- [ ] **Step 7: Run dashboard model tests**

Run: `npx vitest run tests/life-dashboard-model.test.ts tests/navigation.test.ts tests/theme.test.ts`

Expected: PASS for empty data, count correctness, links, route preservation, and all theme token assertions.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/life-dashboard-model.ts src/renderer/src/components/LifeView.tsx src/renderer/src/App.tsx src/renderer/src/styles.css tests/life-dashboard-model.test.ts
git commit -m "feat: add data-backed LifeAssistOS dashboard cards"
```

### Task 4: Shared surface polish and responsive review

**Files:**
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/components/TodoView.tsx`
- Modify: `src/renderer/src/components/ProjectsView.tsx`
- Modify: `src/renderer/src/components/ReviewView.tsx`
- Modify: `src/renderer/src/components/AssistantView.tsx`
- Modify: `src/renderer/src/components/SettingsView.tsx`

**Interfaces:**
- Consumes: Theme tokens, app shell, and dashboard card styles from Tasks 1–3.
- Produces: Consistent rounded-card and action styling across existing screens; all current workflows remain intact.

- [ ] **Step 1: Apply shared visual tokens to existing views**

Adapt existing Todo, project list/board, weekly review, assistant, and settings selectors to the shared panel, border, radius, button, and focus tokens. Add only class hooks required in the named components; keep data actions and forms intact.

- [ ] **Step 2: Add narrow-window and accessibility refinements**

In `styles.css`, stack dashboard cards below `700px`, keep all primary actions reachable at `880×620`, prevent long labels from causing horizontal overflow, retain keyboard focus, and disable nonessential motion for `prefers-reduced-motion`.

- [ ] **Step 3: Run focused regressions and production checks**

Run: `npx vitest run tests/theme.test.ts tests/navigation.test.ts tests/life-dashboard-model.test.ts tests/todo-view-model.test.ts tests/review-view-model.test.ts`

Run: `npm run typecheck`

Run: `npm run build`

Expected: all commands pass with existing view models and routes intact.

- [ ] **Step 4: Inspect the rendered app**

Run: `npm run dev`; inspect Dashboard, Tasks, Projects, Review, Assistant, and Settings at `1280×800` and `880×620`, then use a `700px`-wide renderer viewport. Switch through all five themes and verify card stacking, empty states, keyboard focus, and reduced motion.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/styles.css src/renderer/src/components/TodoView.tsx src/renderer/src/components/ProjectsView.tsx src/renderer/src/components/ReviewView.tsx src/renderer/src/components/AssistantView.tsx src/renderer/src/components/SettingsView.tsx
git commit -m "style: polish LifeAssistOS workspace surfaces"
```
