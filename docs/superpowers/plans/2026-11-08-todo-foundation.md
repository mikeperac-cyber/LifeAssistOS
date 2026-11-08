# To-do App Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the general workspace shell with a durable local to-do experience for capture, daily work, upcoming tasks, subtasks, and completion.

**Architecture:** Reuse `PlanningStore` and its SQLite task/Inbox data, adding only the parent relationship needed for one-level subtasks. Replace the multi-view navigation with a focused Tasks screen and a smaller Settings screen while retaining the existing task reminder service.

**Tech Stack:** Electron 45, React 19, TypeScript, Node SQLite, Vitest, electron-vite.

**Spec:** `docs/superpowers/specs/2026-11-08-todo-foundation.md`

## Global Constraints

- Keep local task and Inbox storage in SQLite and preserve existing task and Inbox rows.
- Keep the product identity `Mike Assist` and existing Windows per-user data path.
- The main navigation contains Tasks and Settings; task filters are Today, Inbox, Upcoming, Completed, and Archived.
- Subtasks are one level deep; reminders remain one-time local notifications while the app is running.
- Projects, labels, recurrence, calendar sync, and focus timers are outside this implementation.

## Review Focus

- Existing databases without `parent_task_id` must migrate without losing tasks or Inbox items — pin with `test_additive_parent_task_migration_preserves_tasks_and_inbox` in Task 1.
- Parent links must not self-reference or become nested, and parent completion must leave child status unchanged — pin with `test_parent_task_validation_rejects_cycles_and_nested_children` and `test_completing_parent_does_not_complete_subtasks` in Task 1.
- Date filters near local midnight must place due-today and upcoming tasks correctly — pin with `test_task_view_filters_use_local_date_boundary` in Task 3.
- Completed and archived tasks must remain separated from Today/Upcoming and from each other — pin with `test_task_view_filters_exclude_done_and_archived_tasks` in Task 3.
- Empty search and punctuation-only search must leave the full task list visible — pin with `test_task_search_handles_empty_and_punctuation_queries` in Task 3.

---

## File Structure

- `src/shared/types.ts` — task model including parent relationship.
- `src/core/planning.ts` — SQLite migration, validation, and local task query behavior.
- `src/renderer/src/navigation.ts` and `Sidebar.tsx` — two-item navigation.
- `src/renderer/src/App.tsx` — focused app shell with Tasks and Settings routes.
- `src/renderer/src/components/TodoView.tsx` — task filters, Inbox, search, and task actions.
- `src/renderer/src/components/TodoTaskRow.tsx` — task and subtask presentation.
- `src/renderer/src/components/TaskEditorDialog.tsx` — add/edit task fields.
- `src/renderer/src/components/ProviderSettingsPanel.tsx` — existing provider setup form and connection test.
- `src/renderer/src/components/SettingsView.tsx` — provider settings, appearance, and local backup/restore.
- `tests/todo-planning.test.ts`, `tests/todo-view-model.test.ts`, `tests/navigation.test.ts` — storage, filtering, and route behavior.

### Task 1: Preserve tasks and add direct subtasks

**Files:**
- Modify: `src/shared/types.ts:705-768`
- Modify: `src/core/planning.ts:24-190`
- Create: `tests/todo-planning.test.ts`

**Interfaces:**
- Produces: `PlanTask.parentTaskId: string | null`.
- Produces: `PlanningStore.addTask(input: { title: string; notes?: string; dueDate?: string | null; remindAt?: string | null; priority?: PlanTaskPriority; parentTaskId?: string | null }): PlanTask`.
- Produces: `PlanningStore.updateTask(id: string, patch: { title?: string; notes?: string; dueDate?: string | null; remindAt?: string | null; priority?: PlanTaskPriority; status?: PlanTaskStatus; parentTaskId?: string | null }): PlanTask`.

- [ ] **Step 1: Write failing storage tests**

Add a test-only `createLegacyPlanningDatabase(file)` helper that creates the current pre-subtask `tasks` and `inbox` schema. Use it in `test_additive_parent_task_migration_preserves_tasks_and_inbox`, insert one task and Inbox item, initialize `PlanningStore`, and assert both rows remain and the task has `parentTaskId: null`. Add `test_parent_task_validation_rejects_cycles_and_nested_children` and assert self-parenting and a child whose parent is already a child are rejected. Add `test_completing_parent_does_not_complete_subtasks` and assert the child remains open after the parent is marked done.

- [ ] **Step 2: Run the targeted tests and verify they fail**

Run: `npm test -- --reporter=verbose tests/todo-planning.test.ts`
Expected: FAIL because the model and store do not yet expose the parent relationship.

- [ ] **Step 3: Add an additive migration and one-level parent validation**

Add nullable `parent_task_id` to `tasks` when absent. Map it to `PlanTask.parentTaskId`; accept it in `addTask` and `updateTask`; reject self-parenting, missing parents, and parents that themselves have a parent. Do not rewrite or delete existing rows.

- [ ] **Step 4: Run the targeted tests and verify they pass**

Run: `npm test -- --reporter=verbose tests/todo-planning.test.ts`
Expected: PASS for migration preservation, child persistence, invalid parent rejection, and independent completion.

- [ ] **Step 5: Commit the task model migration**

```bash
git add src/shared/types.ts src/core/planning.ts tests/todo-planning.test.ts
git commit -m "feat: add todo subtasks"
```

### Task 2: Build the focused app and Settings shell

**Files:**
- Modify: `src/renderer/src/navigation.ts:1-90`
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/SettingsView.tsx`
- Create: `src/renderer/src/components/ProviderSettingsPanel.tsx`
- Modify: `tests/navigation.test.ts`

**Interfaces:**
- Produces: `View = 'tasks' | 'settings'` and `normalizeView(value: unknown): View`, which maps retired or invalid saved routes to `tasks`.
- Produces: `ProviderSettingsPanel({ settings, onSettingsUpdated }: { settings: PublicSettings; onSettingsUpdated: (settings: PublicSettings) => void })`, preserving current provider, endpoint, model, key-entry, and connection-test controls.
- Consumes: `window.assist.getSettings()`, `updateSettings(patch)`, `testProvider()`, `createBackup()`, and `restoreBackup()`.

- [ ] **Step 1: Write failing navigation tests and remove obsolete route tests**

Add `test_navigation_exposes_only_tasks_and_settings` and assert the navigation metadata contains exactly Tasks and Settings, with Tasks as the default route. Add `test_legacy_view_ids_fall_back_to_tasks` for persisted old view IDs.
Remove the global-search section test file and old IntegrationsView route assertions; those destinations are no longer reachable in the task app.

- [ ] **Step 2: Run the targeted navigation tests and verify they fail**

Run: `npm test -- --reporter=verbose tests/navigation.test.ts`
Expected: FAIL because legacy feature routes remain in the navigation.

- [ ] **Step 3: Mount the focused Tasks and Settings shell**

Replace the app shell with Tasks and Settings routes, with Tasks as the default. Map retired persisted route IDs to Tasks. Extract the existing provider controls into `ProviderSettingsPanel`; keep Settings limited to that panel, appearance, and local backup/restore. Keep the existing provider presets, settings update/test APIs, key status, and blank API-key input behavior.

- [ ] **Step 4: Run the targeted navigation tests and verify they pass**

Run: `npm test -- --reporter=verbose tests/navigation.test.ts`
Expected: PASS for route count, Tasks default, and retired-route fallback. Inspect the Settings screen to confirm current provider controls and backup/restore remain available and no other legacy view is reachable.

- [ ] **Step 5: Commit the focused shell**

```bash
git add src/renderer/src/navigation.ts src/renderer/src/components/Sidebar.tsx src/renderer/src/App.tsx src/renderer/src/components/SettingsView.tsx src/renderer/src/components/ProviderSettingsPanel.tsx tests/navigation.test.ts
git commit -m "refactor: focus app shell on tasks"
```

### Task 3: Build the task views and editor

**Files:**
- Create: `src/renderer/src/components/TodoView.tsx`
- Create: `src/renderer/src/components/TodoTaskRow.tsx`
- Create: `src/renderer/src/components/TaskEditorDialog.tsx`
- Create: `src/renderer/src/components/todo-view-model.ts`
- Create: `tests/todo-view-model.test.ts`
- Modify: `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: `window.assist.getToday()`, `getPlanTasks(includeCompleted?: boolean)`, `addPlanTask(input)`, `updatePlanTask(id, patch)`, `captureInbox(text)`, `convertInbox(id, input?)`, and `dismissInbox(id)`.
- Produces: `filterTasksForView(tasks: PlanTask[], view: 'today' | 'upcoming' | 'completed' | 'archived', localDate: string): PlanTask[]` and `filterTasksByQuery(tasks: PlanTask[], query: string): PlanTask[]`.

- [ ] **Step 1: Write failing view-model tests**

Add `test_task_view_filters_use_local_date_boundary`, `test_task_view_filters_exclude_done_and_archived_tasks`, and `test_task_search_handles_empty_and_punctuation_queries`. Assert Today includes overdue, today, and undated open tasks; Upcoming includes only future-dated open tasks; Completed includes only done tasks; Archived includes only cancelled tasks.

- [ ] **Step 2: Run the targeted view-model tests and verify they fail**

Run: `npm test -- --reporter=verbose tests/todo-view-model.test.ts`
Expected: FAIL because the view-model functions do not exist.

- [ ] **Step 3: Implement view filters and focused task UI**

Create Today, Inbox, Upcoming, Completed, and Archived filters; title/notes search; quick task capture; due date, reminder, priority, and notes editor; completion and archive actions; one-level subtask display and editing. Filter each task by its own state/date so subtasks remain independently visible with their parent title as context. Keep Inbox conversion editable before task creation. Use the existing quick-capture shortcut and reminder IPC.

- [ ] **Step 4: Run targeted tests**

Run: `npm test -- --reporter=verbose tests/todo-view-model.test.ts tests/todo-planning.test.ts tests/navigation.test.ts`
Expected: PASS for task filters, storage migration, and routing.
Expected: PASS for task filters, storage migration, and routing. Run the typecheck and build gates after the retirement plan's Task 1 removes legacy views that still import the pre-rebuild route union; that task owns the consolidated compile and bundle checks.

- [ ] **Step 5: Commit the local task experience**

```bash
git add src/renderer/src/components/TodoView.tsx src/renderer/src/components/TodoTaskRow.tsx src/renderer/src/components/TaskEditorDialog.tsx src/renderer/src/components/todo-view-model.ts src/renderer/src/styles.css tests/todo-view-model.test.ts
git commit -m "feat: add local todo views"
```

