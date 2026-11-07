# All-Screen UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make every Mike Assist screen feel cohesive, readable, and intentionally sized while preserving its current actions and permission behavior.

**Architecture:** Keep the current Electron, React, TypeScript, and CSS stack. Define shared content width and gutter values in the existing stylesheet, then refine the existing view roots and responsive grids with a small number of targeted markup changes where grouping needs semantic structure.

**Tech Stack:** Electron 45, React 19, TypeScript, Vite, existing CSS variables and container queries.

**Spec:** `docs/superpowers/specs/2026-11-07-all-screens-polish-design.md`

## Global Constraints

- Keep the current native Electron, React, TypeScript, and CSS implementation.
- Reuse current CSS variables and theme support; new raw colors should not be introduced for routine surfaces.
- Prefer changes to existing page styles and small shared layout helpers over new dependencies or large component rewrites.
- Preserve all current actions and their loading, disabled, confirmation, and error behavior.
- Do not migrate the app to shadcn, Tailwind, Radix, or another component framework.
- Do not add or run tests unless the user asks; use typecheck, build, and source review for verification.
- Do not use desktop UI automation in this project continuation.
- Keep the already implemented sidebar collapse, Recent chats placement, Chat composer behavior, and Settings General/Memory navigation intact.

## Review Focus

Use focused source and diff review for these conditions; no test files or test commands are part of this plan:

1. Sidebar open and closed states must use the full available main pane without overflow or a stale gutter.
2. Narrow content containers near the existing 1100px, 760px, and 620px container-query thresholds must reflow without clipped controls.
3. Empty, loading, error, success, setup-required, disabled, and confirmation states must remain legible and actionable.
4. Long chat messages, activity descriptions, document text, and provider names must wrap or scroll inside their own surfaces without forcing page-wide horizontal overflow.
5. Light and dark themes must retain contrast, visible focus, and the existing keyboard behavior.

---

### Task 1: Establish shared page width and gutter rules

**Files:**
- Modify: `src/renderer/src/styles.css` (`.content`, current view-root width rules, responsive container queries)

**Interfaces:**
- Consumes: existing `.main`, `.content`, and view-root classes; `.main` is already an inline-size container.
- Produces: CSS custom properties `--view-wide-max: 1540px`, `--view-standard-max: 1360px`, `--view-reading-max: 980px`, and `--view-gutter: clamp(20px, 2.2cqi, 32px)` on `.content` for later tasks.

- [ ] **Step 1: Inventory current root sizing rules** for the view roots in the approved spec and mark duplicate or conflicting max-width, margin, padding, and overflow declarations in `styles.css`.
- [ ] **Step 2: Add the four shared content properties to `.content`** and keep width calculations relative to the existing `.main` inline-size container.
- [ ] **Step 3: Replace conflicting root widths and horizontal padding** with the shared tiers, `margin-inline: auto`, and `padding-inline: var(--view-gutter)`: dashboards/card grids use the wide tier, split workspaces/forms use the standard tier, and message/document reading columns use the reading tier. Preserve purpose-specific widths inside cards.
- [ ] **Step 4: Keep view scrolling inside the view or its intended pane** with `min-width: 0` and `min-height: 0` where existing flex/grid children otherwise force overflow; retain the current responsive breakpoints.
- [ ] **Step 5: Run `git diff --check`** and confirm the stylesheet diff changes existing layout rules instead of adding a second competing override block.
- [ ] **Step 6: Commit** as `style: define shared view layout widths`.

### Task 2: Balance Chat transcript and composer

**Files:**
- Modify: `src/renderer/src/styles.css` (`.chat-column`, `.composer-wrap`, `.composer`, `.composer-toolbar` and container rules)
- Read only: `src/renderer/src/components/ChatView.tsx` to verify the existing controls and semantic order

**Interfaces:**
- Consumes: shared width properties from Task 1 and the existing two-level composer markup.
- Produces: a transcript capped at `var(--view-reading-max)` and a composer capped at `min(var(--view-wide-max), 1180px)`, both fluid below those caps.

- [ ] **Step 1: Confirm the current Chat DOM order and control set** in `ChatView.tsx`; do not change prompt, attachment, provider/model, effort, voice, queue, send, stop, or keyboard behavior.
- [ ] **Step 2: Apply the transcript and composer caps** to existing Chat selectors, keeping centered alignment, full available width, and zero minimum widths for nested controls.
- [ ] **Step 3: Refine the toolbar wrap rules** so controls remain in a compact, readable row when space permits and wrap as complete groups at narrower container widths.
- [ ] **Step 4: Run `git diff --check`** and review the CSS diff against the composer ordering and narrow-width rules in the approved spec.
- [ ] **Step 5: Commit** as `style: balance chat workspace and composer`.

### Task 3: Polish Today and personal/work dashboards

**Files:**
- Modify: `src/renderer/src/components/TodayView.tsx` (semantic grouping for connected-service panels)
- Modify: `src/renderer/src/styles.css` (`.today-*`, `.work-view`, `.coach-view`, `.finance-view` and their grids)
- Read only: `src/renderer/src/components/WorkView.tsx`, `CoachView.tsx`, `FinanceView.tsx` to confirm existing content and actions

**Interfaces:**
- Consumes: the shared width tiers from Task 1 and the existing task, inbox, provider, coaching, and finance actions.
- Produces: a semantic `Connected services` group around Today’s existing provider panels, plus balanced wide dashboard roots and responsive cards.

- [ ] **Step 1: Wrap Today’s existing connected-provider panels after the primary tasks/inbox grid** in a section labelled `Connected services`; preserve their DOM order, disclosures, empty states, and controls.
- [ ] **Step 2: Style the Today service section as a responsive card grid** using `repeat(auto-fit, minmax(min(100%, 430px), 1fr))`; keep tasks and inbox visually primary.
- [ ] **Step 3: Move Today, Work, and Finances to the wide width tier**; move Coach to the standard tier and balance its desktop columns without shrinking controls or saved journal text.
- [ ] **Step 4: Align empty and status states** for these views with the shared card rhythm while keeping the existing error/retry, capture, reminder, meeting, coaching, and transaction behavior.
- [ ] **Step 5: Run `npm run typecheck` and `git diff --check`**.
- [ ] **Step 6: Commit** as `style: refine dashboard view layouts`.

### Task 4: Expand browsing and knowledge workspaces

**Files:**
- Modify: `src/renderer/src/styles.css` (`.email-search-view`, `.cloud-files-view`, `.cloud-files-layout`, `.research-view`, `.vault-view`, `.teaching-view`, `.teaching-grid` and related responsive rules)
- Read only: `src/renderer/src/components/ConnectedEmailView.tsx`, `ConnectedFilesView.tsx`, `ResearchView.tsx`, `VaultView.tsx`, and `TeachingView.tsx` to verify current states and actions

**Interfaces:**
- Consumes: the standard and wide width tiers from Task 1 and existing split-pane/card markup.
- Produces: standard-width email/file/research/vault workspaces, a wide teaching-pack grid with cards no narrower than 320px when available, and pane sizing that uses desktop height.

- [ ] **Step 1: Move Email, Cloud Files, Research, and Vault roots to the standard tier** and align their outer gutters; keep long-form reader/document text readable.
- [ ] **Step 2: Set Cloud Files and Vault split panes to consume remaining width and height** with stable minimum list widths and `min-width: 0` on reader/editor panes.
- [ ] **Step 3: Keep Research’s project rail and result workspace balanced** and make the no-project state occupy the intended workspace area.
- [ ] **Step 4: Move Teaching to the wide tier** and update `.teaching-grid` to use `minmax(min(100%, 320px), 1fr)` so cards reflow without becoming excessively narrow.
- [ ] **Step 5: Run `git diff --check`** and confirm existing provider setup, file search, document, research, and Start in chat controls remain untouched.
- [ ] **Step 6: Commit** as `style: expand browsing and knowledge workspaces`.

### Task 5: Align operational and library screens

**Files:**
- Modify: `src/renderer/src/styles.css` (`.scheduled-view`, `.integrations-view`, `.workflow-view`, `.skills-view`, `.activity`, `.audit` and their grids/panes)
- Read only: `src/renderer/src/components/ScheduledTasksView.tsx`, `IntegrationsView.tsx`, `WorkflowsView.tsx`, `SkillsView.tsx`, `ActivityView.tsx`, and `AuditView.tsx` to verify action and privacy behavior

**Interfaces:**
- Consumes: shared wide and standard width tiers from Task 1 and current operational view markup.
- Produces: appropriately wide schedules, provider cards, workflows, and audit views; a standard-width skills editor/list split; responsive cards and panes.

- [ ] **Step 1: Move Scheduled, Integrations, and Workflows to the wide tier**; turn `.scheduled-list` into `repeat(auto-fit, minmax(min(100%, 480px), 1fr))`, use a 300px minimum for integration cards, and preserve workflow starter and saved-workflow two-column grids.
- [ ] **Step 2: Move Skills to the standard tier** and keep its searchable list and editor using available height; style the no-selection state to explain the first action clearly.
- [ ] **Step 3: Give Activity a wide-but-capped timeline** and align the detailed audit view, time column, integrity status, and toolbar without changing audit data content.
- [ ] **Step 4: Retain run/remove confirmations, connection status, workflow actions, skill state, audit export, and log integrity behavior exactly as implemented.**
- [ ] **Step 5: Run `git diff --check`** and review every operational view selector against the approved screen list.
- [ ] **Step 6: Commit** as `style: refine operational view layouts`.

### Task 6: Balance General Settings and Memory

**Files:**
- Modify: `src/renderer/src/components/SettingsView.tsx` (section modifier class on the existing root)
- Modify: `src/renderer/src/styles.css` (`.settings`, `.settings-section-tabs`, `.settings-section`, `.memory`, `.memory-tools-grid`, `.memory-list`)
- Read only: `src/renderer/src/components/MemoryView.tsx` to verify existing data actions

**Interfaces:**
- Consumes: existing General/Memory section selection and current saved-memory store.
- Produces: `.settings-general` at the standard tier with a two-column section grid above the existing container breakpoint and one column below it; `.settings-memory` uses the wide tier for its add/search/list sections.

- [ ] **Step 1: Add the active section modifier to the existing Settings root** as `settings settings-${section}`; keep the General/Memory controls and section order unchanged.
- [ ] **Step 2: Set `.settings-general` to the standard tier** and make the General/Memory section control span the full content width.
- [ ] **Step 3: Apply a two-column grid to General `.settings-section` cards** at wide container sizes; make Appearance span both columns, then collapse to one column below the 1100px container threshold.
- [ ] **Step 4: Set `.settings-memory` to the wide tier** and align Memory add, search, active facts, empty state, and archived facts to the same outer gutters while preserving readable text measure.
- [ ] **Step 5: Confirm by source review that save approval, search, edit, archive, delete confirmation, citations, and fact data flow remain unchanged.**
- [ ] **Step 6: Run `npm run typecheck` and `git diff --check`**.
- [ ] **Step 7: Commit** as `style: refine settings and memory layouts`.

### Task 7: Harmonize shared dialogs and transient states

**Files:**
- Modify: `src/renderer/src/styles.css` (Quick capture, Global search, approval modal, loading notices and app alerts)
- Read only: `src/renderer/src/components/AccessibleDialog.tsx`, `QuickCaptureDialog.tsx`, `GlobalSearchDialog.tsx`, and `ApprovalModal.tsx` to verify labels and focus behavior

**Interfaces:**
- Consumes: existing dialog components, current theme tokens, and existing permission copy.
- Produces: consistent dialog padding, bounded widths, action alignment, focus treatment, and loading/error/status spacing without changing dialog semantics.

- [ ] **Step 1: Review each dialog’s current class and semantic title/focus structure.**
- [ ] **Step 2: Harmonize existing dialog selectors** using current surface, border, text, and focus tokens; keep confirmation and approval copy visible and preserve width needed for detailed permission requests.
- [ ] **Step 3: Align shell loading and alert spacing** with the content gutters from Task 1; do not alter startup loading or retry behavior.
- [ ] **Step 4: Run `git diff --check`** and inspect the affected CSS selectors for both theme token use and visible focus.
- [ ] **Step 5: Commit** as `style: harmonize dialogs and transient states`.

### Task 8: Verify complete screen coverage and commit the finish

**Files:**
- Review: `src/renderer/src/App.tsx`, all routed view components listed in the design spec, and `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: all layout refinements from Tasks 1–7.
- Produces: a clean, buildable branch whose CSS covers every routed view and shared dialog named by the spec.

- [ ] **Step 1: Trace every `view ===` route in `App.tsx`** to its view component and verify its root has an intentional width, scroll owner, and responsive rule from the approved spec.
- [ ] **Step 2: Run `npm run typecheck`.** Expected: TypeScript completes with no errors.
- [ ] **Step 3: Run `npm run build`.** Expected: Electron/Vite production build completes successfully.
- [ ] **Step 4: Run `git diff --check` and inspect `git diff`** for unintended behavior, duplicated CSS overrides, raw color additions, or changes to approval/data semantics.
- [ ] **Step 5: Commit** the final review-only adjustments as `style: finish all-screen polish` and confirm `git status --short --branch` is clean.

---

## Plan Self-Review

- **Spec coverage:** Task 1 covers shared shell widths and responsive behavior; Tasks 2–7 cover every screen and dialog in the screen-by-screen requirements; Task 8 maps every `App.tsx` route and builds the app.
- **Step granularity:** Each step is a single implementation, source review, or build action with a visible outcome. No new component library, test suite, or cross-cutting behavior is planned.
- **Type consistency:** The only planned JSX addition is the Today connected-services section; it does not change props or IPC contracts.
- **Review focus:** The five classes of layout and state risks are listed above and assigned to source review in Tasks 1–7 and the final route audit.
- **Proportion:** The plan is grouped into seven focused UI surfaces plus a final whole-app review; CSS is consolidated in the existing stylesheet rather than split into many one-off files.
