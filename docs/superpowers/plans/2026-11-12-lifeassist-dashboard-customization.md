# LifeAssistOS Dashboard Customization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each user reorder or hide dashboard cards with a keyboard-accessible, device-local preference.

**Architecture:** Define a versioned, validated renderer model for the fixed dashboard widget IDs. Persist it only in local storage; the Dashboard renders cards from normalized order and an accessible Customize panel provides visibility and movement controls.

**Tech Stack:** React, TypeScript, browser local storage, Vitest.

**Spec:** [Dashboard customization spec](../specs/2026-11-12-lifeassist-dashboard-customization.md) and [dashboard feature set](../specs/2026-11-12-lifeassistos-dashboard-design.md).

**Dependency:** Implement after the [core dashboard](2026-11-12-lifeassistos-dashboard-design.md), [weekly completion widget](2026-11-12-lifeassist-weekly-completion-widget.md), and [pinned notes](2026-11-12-lifeassist-pinned-notes.md), so all nine widgets are available.

## Global Constraints

- Keep the exact nine widget IDs and `version: 1` schema above.
- Keep customization device-local; do not put it in user-data backups or encrypted folder sync.
- Preserve visible focus, keyboard-accessible ordering controls, and one-column layout below `700px`.

## Review Focus

- Missing or corrupt local storage: render the default layout and do not crash. Test in Task 1.
- Unsupported schema version: restore the default layout. Test in Task 1.
- Unknown or duplicate IDs: drop unknowns, dedupe valid IDs, append omitted valid IDs once. Test in Task 1.
- Summary hidden or moved: force it visible and first. Test in Task 1.
- Storage write failure: keep the new layout in current state while avoiding a UI error crash. Test in Task 1.

---

### Task 1: Versioned local layout model

**Files:**
- Create: `src/renderer/src/dashboard-layout.ts`
- Create: `tests/dashboard-layout.test.ts`

**Interfaces:**
- Produces: `DashboardWidgetId`, the nine IDs from the spec; `DashboardLayout = { version: 1; order: DashboardWidgetId[]; hidden: DashboardWidgetId[] }`; `DASHBOARD_LAYOUT_STORAGE_KEY = 'lifeassist-dashboard-layout-v1'`; `parseDashboardLayout(value: unknown): DashboardLayout`; `moveDashboardWidget(layout, id, direction: -1 | 1): DashboardLayout`; `setDashboardWidgetVisibility(layout, id, visible): DashboardLayout`; `readDashboardLayout(storage): DashboardLayout`; and `writeDashboardLayout(layout, storage): boolean`.

- [ ] **Step 1: Add failing layout-model tests**

Create `tests/dashboard-layout.test.ts` with `test_default_layout_keeps_summary_visible_first`, `test_parser_deduplicates_and_appends_missing_known_widgets`, `test_parser_resets_an_unsupported_version`, `test_move_widget_keeps_summary_fixed`, `test_summary_cannot_be_hidden`, and `test_storage_errors_fall_back_or_return_false`. Assert exact widget IDs, fixed summary order/visibility, deterministic unknown/duplicate handling, and safe storage failures.

- [ ] **Step 2: Run tests and confirm they fail**

Run: `npx vitest run tests/dashboard-layout.test.ts`

Expected: FAIL because `dashboard-layout.ts` does not exist.

- [ ] **Step 3: Implement layout normalization and safe storage helpers**

Implement the exact types and function signatures in `dashboard-layout.ts`. A valid version-1 object keeps known IDs once in given order, appends missing valid IDs in default order, forces `today-summary` first, and removes it from `hidden`. Invalid top-level data or unsupported versions return the default. Catch storage read/write errors.

- [ ] **Step 4: Run model tests**

Run: `npx vitest run tests/dashboard-layout.test.ts`

Expected: PASS for normalization, ordering, summary invariants, and storage failure behavior.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/dashboard-layout.ts tests/dashboard-layout.test.ts
git commit -m "feat: add local dashboard layout preferences"
```

### Task 2: Customize panel and ordered card rendering

**Files:**
- Modify: `src/renderer/src/components/LifeView.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `tests/dashboard-layout.test.ts`

**Interfaces:**
- Consumes: `readDashboardLayout`, `writeDashboardLayout`, `moveDashboardWidget`, and `setDashboardWidgetVisibility` from Task 1.
- Produces: Dashboard cards render in saved order except the fixed first summary; remaining cards can be hidden, restored, and moved using the Customize panel.

- [ ] **Step 1: Add a render-model ordering assertion**

Extend `tests/dashboard-layout.test.ts` with `test_visible_widgets_follow_layout_order_and_exclude_hidden_widgets`, asserting the dashboard renderer receives the visible IDs in normalized order.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/dashboard-layout.test.ts -t "visible widgets follow layout order"`

Expected: FAIL because there is no visible-widget selector.

- [ ] **Step 3: Add the accessible Customize panel**

In `LifeView.tsx`, add a **Customize** button that opens a dialog/panel with one checkbox per widget and **Move up**/**Move down** buttons. Keep the summary disabled as visible/fixed first. Save changes to local storage and update the current rendered layout.

- [ ] **Step 4: Render widgets from normalized order**

In `LifeView.tsx`, map widget IDs to the existing summary, agenda, focus, goals, projects, weekly completion, routines, pinned notes, and upcoming cards. Render only visible IDs in `layout.order`; hide the widget if its ID is in `layout.hidden`.

- [ ] **Step 5: Style customization and verify keyboard flow**

In `styles.css`, make the customization panel responsive, preserve `:focus-visible`, and ensure move controls work with keyboard input. Confirm summary cannot be hidden and remains before all visible cards.

- [ ] **Step 6: Run layout and dashboard tests**

Run: `npx vitest run tests/dashboard-layout.test.ts tests/life-dashboard-model.test.ts tests/weekly-completion-model.test.ts`

Run: `npm run typecheck`

Expected: PASS with all widget IDs renderable and no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/LifeView.tsx src/renderer/src/styles.css tests/dashboard-layout.test.ts
git commit -m "feat: customize LifeAssistOS dashboard cards"
```
