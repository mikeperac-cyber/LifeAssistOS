# LifeAssistOS Pinned Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users pin journal notes, sync pin state safely, and surface recent pinned notes on the dashboard.

**Architecture:** Add a default-false SQLite column with an idempotent `LifeStore` migration. Expose a narrowly validated pin IPC action that updates `updated_at`; the existing encrypted folder-sync row/version logic will transport the new column and tolerate older snapshots.

**Tech Stack:** Electron IPC, TypeScript, Node SQLite, React, Vitest.

**Spec:** [Pinned journal notes spec](../specs/2026-11-12-lifeassist-pinned-notes.md) and [dashboard feature set](../specs/2026-11-12-lifeassistos-dashboard-design.md).

**Dependency:** Add the dashboard card after [the core dashboard plan](2026-11-12-lifeassistos-dashboard-design.md); implement this storage/API plan after [weekly completion](2026-11-12-lifeassist-weekly-completion-widget.md).

## Global Constraints

- Existing journal rows migrate to `is_pinned = 0`; do not rewrite title, content, date, goal, or Area values.
- Pinning only changes `is_pinned` and `updated_at`.
- Preserve encryption and sync conflict resolution; credentials and pin state remain private workspace data.
- Existing snapshots without `is_pinned` remain importable as unpinned notes.

## Review Focus

- Existing database without the column: migration adds it once and old entries read unpinned. Test in Task 1.
- Repeated application startup: migration is idempotent. Test in Task 1.
- Unknown note ID or nonboolean pin input: reject without changing another note. Test in Task 2.
- Pin conflict across devices: newest journal row version carries pin state through encrypted sync. Test in Task 3.
- Old encrypted snapshot without `is_pinned`: import as unpinned without rejecting the snapshot. Test in Task 3.

---

### Task 1: Journal schema migration and model mapping

**Files:**
- Modify: `src/core/lifeos.ts`
- Modify: `src/shared/types.ts`
- Create: `tests/lifeos.test.ts`

**Interfaces:**
- Consumes: Existing `journal_entries` table and `JournalEntry` row mapping.
- Produces: `JournalEntry.isPinned: boolean`; `journal_entries.is_pinned INTEGER NOT NULL DEFAULT 0`; `journalFromRow` maps 0/1 to false/true.

- [ ] **Step 1: Add failing schema and mapping tests**

Create `tests/lifeos.test.ts` using a temporary `PlanningStore` SQLite database and `LifeStore`. Add `test_init_migrates_existing_journal_rows_as_unpinned`, asserting an old row survives migration and maps `isPinned === false`; add `test_init_adds_journal_pin_column_only_once`, calling `init()` twice and asserting exactly one `is_pinned` column.

- [ ] **Step 2: Run tests and confirm they fail**

Run: `npx vitest run tests/lifeos.test.ts`

Expected: FAIL because `JournalEntry` has no pin field and `LifeStore.init()` has no migration.

- [ ] **Step 3: Implement the idempotent migration**

In `LifeStore.init()`, inspect `PRAGMA table_info(journal_entries)` and issue `ALTER TABLE journal_entries ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0` only when absent. Extend `JournalRow` and `journalFromRow`; add `isPinned: boolean` to `JournalEntry` in `src/shared/types.ts`.

- [ ] **Step 4: Run migration tests**

Run: `npx vitest run tests/lifeos.test.ts`

Expected: PASS with data preserved and repeated initialization harmless.

- [ ] **Step 5: Commit**

```bash
git add src/core/lifeos.ts src/shared/types.ts tests/lifeos.test.ts
git commit -m "feat: add journal note pin storage"
```

### Task 2: Pin/unpin IPC and journal controls

**Files:**
- Modify: `src/core/lifeos.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/ipc/lifeos-handlers.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/components/LifeView.tsx`
- Modify: `tests/lifeos.test.ts`
- Modify: `tests/ipc-contract.test.ts`

**Interfaces:**
- Consumes: `JournalEntry.isPinned` and migrated row schema from Task 1.
- Produces: `LifeStore.setJournalPinned(id: string, isPinned: boolean): JournalEntry`; `LifeStore.listPinnedJournal(limit = 3): JournalEntry[]`; and `window.assist.setJournalPinned(id: string, isPinned: boolean): Promise<LifeMutationResult>` plus `window.assist.getPinnedJournalEntries(): Promise<JournalEntry[]>` via `assist:journal-pin` and `assist:journal-pinned-list`.

- [ ] **Step 1: Add failing pin mutation and IPC tests**

Add `test_set_journal_pinned_updates_only_pin_and_updated_at`, `test_set_journal_pinned_rejects_unknown_id`, and `test_list_pinned_journal_returns_latest_three_even_when_notes_are_old` in `tests/lifeos.test.ts`. Extend `tests/ipc-contract.test.ts` to assert the preload contract includes both journal-pin channels and that nonboolean/invalid IDs return an error.

- [ ] **Step 2: Run focused tests and confirm they fail**

Run: `npx vitest run tests/lifeos.test.ts tests/ipc-contract.test.ts`

Expected: FAIL because the method and IPC route do not exist.

- [ ] **Step 3: Implement pin mutation and route validation**

Implement `setJournalPinned` with one SQL update of `is_pinned` and `updated_at`, then return the updated journal row. Implement `listPinnedJournal(limit = 3)` using `WHERE is_pinned = 1 ORDER BY updated_at DESC LIMIT ?`. Register `assist:journal-pin` and `assist:journal-pinned-list` in `lifeos-handlers.ts`; pin updates require an ID accepted by the existing `isId` helper and an actual boolean. Add both exact methods to shared IPC and the preload bridge.

- [ ] **Step 4: Add pin controls to the journal list**

In `JournalTab`, add a button labeled **Pin note** or **Unpin note** from `entry.isPinned`; call the IPC method, surface errors with the existing error state, then refresh the journal list.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run tests/lifeos.test.ts tests/ipc-contract.test.ts`

Expected: PASS with valid toggles updating timestamps and invalid requests leaving data unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/core/lifeos.ts src/shared/ipc.ts src/main/ipc/lifeos-handlers.ts src/preload/index.ts src/renderer/src/components/LifeView.tsx tests/lifeos.test.ts tests/ipc-contract.test.ts
git commit -m "feat: pin and unpin LifeAssistOS journal notes"
```

### Task 3: Dashboard pinned-notes card and sync compatibility

**Files:**
- Modify: `src/renderer/src/components/LifeView.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `tests/folder-sync.test.ts`
- Modify: `tests/lifeos.test.ts`

**Interfaces:**
- Consumes: `JournalEntry.isPinned` and IPC mutation from Task 2.
- Produces: Dashboard card showing at most three pinned entries ordered by `updatedAt DESC`; pin updates are carried by existing encrypted journal-row snapshots.

- [ ] **Step 1: Add old-snapshot and peer-sync tests**

In `tests/folder-sync.test.ts`, add `test_old_journal_snapshots_default_missing_pin_column_to_false` and `test_journal_pin_state_syncs_with_newer_row_timestamp`. Assert an old row without the field imports with false, and a newer pinned row appears pinned after a second device syncs it.

- [ ] **Step 2: Run folder-sync tests and confirm they fail**

Run: `npx vitest run tests/folder-sync.test.ts`

Expected: FAIL because snapshots/schema fixtures do not yet include or assert the pin state.

- [ ] **Step 3: Add the pinned-notes card**

In `LifeView.tsx`, load `window.assist.getPinnedJournalEntries()` with the existing workspace requests. Add pin/unpin action in the card and show a button linking to Notes & journal when none are pinned. Style it using the shared card tokens.

- [ ] **Step 4: Verify encrypted sync compatibility**

Confirm `LifeStore.init()` runs before sync, so new clients have the column. Keep `folder-sync.ts`’s generic `SELECT *`/schema-column filtering. For legacy snapshots, the database default supplies false when the row has no `is_pinned` field; the sync tests must prove this.

- [ ] **Step 5: Run life and sync tests**

Run: `npx vitest run tests/folder-sync.test.ts tests/lifeos.test.ts tests/ipc-contract.test.ts`

Expected: PASS for migration, pin IPC, old snapshots, and multi-device pin propagation.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/LifeView.tsx src/renderer/src/styles.css tests/folder-sync.test.ts tests/lifeos.test.ts
git commit -m "feat: sync pinned journal notes and show them on Dashboard"
```
