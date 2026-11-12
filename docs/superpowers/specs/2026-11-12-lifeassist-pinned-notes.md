# LifeAssistOS Pinned Journal Notes

## Goal

Let users pin journal entries and surface their most recently updated pinned notes on the dashboard.

## Requirements

- Add `journal_entries.is_pinned INTEGER NOT NULL DEFAULT 0` with an idempotent migration in `LifeStore.init()`.
- Expose `JournalEntry.isPinned: boolean`. Convert the SQLite integer to boolean in `journalFromRow`; existing entries read as `false`.
- Add `LifeStore.setJournalPinned(id: string, isPinned: boolean): JournalEntry`; validate the ID, update the pin and `updated_at` in one statement, and return the updated row.
- Add `LifeStore.listPinnedJournal(limit = 3): JournalEntry[]`, ordered by `updated_at DESC`, and expose it as `window.assist.getPinnedJournalEntries(): Promise<JournalEntry[]>`.
- Add IPC channel `assist:journal-pin`, validate `{ id: string, isPinned: boolean }` in `lifeos-handlers.ts`, expose `setJournalPinned(id, isPinned)` through `shared/ipc.ts` and the preload bridge.
- Show a pin/unpin action in the journal list and a dashboard card from the dedicated pinned-note query, with up to three entries ordered by `updatedAt DESC`; this includes pinned entries older than the regular 250-entry journal list. Empty state links to Notes & journal.
- Preserve local backup behavior and propagate pin updates through encrypted folder sync by using the existing journal row timestamp versioning. Old snapshots without the new column default to unpinned.

## Global constraints

- Existing journal rows migrate to `is_pinned = 0`; do not rewrite title, content, date, goal, or Area values.
- Pinning only changes `is_pinned` and `updated_at`.
- Preserve encryption and sync conflict resolution; credentials and pin state remain private workspace data.
- Existing snapshots without `is_pinned` remain importable as unpinned notes.
