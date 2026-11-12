# LifeAssistOS Dashboard Customization

## Goal

Let users tailor the dashboard card order and visibility with an accessible local preference.

## Requirements

- Define `DashboardWidgetId` as the nine IDs: `today-summary`, `agenda`, `focus`, `goals`, `projects`, `weekly-completions`, `routines`, `pinned-notes`, `upcoming`.
- Define `DashboardLayout` as `{ version: 1; order: DashboardWidgetId[]; hidden: DashboardWidgetId[] }`.
- Use storage key `lifeassist-dashboard-layout-v1`; no new database or cloud-sync record.
- Summary remains visible and fixed first. The other eight cards can be reordered and shown/hidden.
- Provide an accessible Customize panel with visibility checkboxes and Move up/Move down buttons; no drag-only interaction.
- Normalize malformed JSON, unsupported versions, unknown IDs, duplicates, omitted IDs, and invalid hidden IDs deterministically: restore the default order, append missing valid IDs, dedupe lists, and discard unknown IDs. Never allow the summary into the hidden list.
- Closing or reopening the app preserves the local layout. If local storage is unavailable, use the default layout for the current session.

## Global constraints

- Keep the exact nine widget IDs and `version: 1` schema above.
- Keep customization device-local; do not put it in user-data backups or encrypted folder sync.
- Preserve visible focus, keyboard-accessible ordering controls, and one-column layout below `700px`.
