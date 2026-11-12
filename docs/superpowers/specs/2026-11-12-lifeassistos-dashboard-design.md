# LifeAssistOS Dashboard Feature Set

## Goal

Give LifeAssistOS a polished dashboard inspired by the user-provided reference and add the ten selected dashboard features using the app’s real planning and life-workspace data.

## Reference interpretation

Use the attached image as inspiration for its near-black canvas, vivid violet primary action, soft rounded charcoal cards, slim icon-led navigation, spacious dashboard grid, and restrained amber/pink secondary accents. Do not copy its product name, illustration, text, avatar, integrations, or analytics. LifeAssistOS has no user-profile, notification, team, or integration-directory data to display.

## Design direction

- Midnight is the signature appearance: deep ink (`#0b0910`) for the canvas, charcoal (`#15121b`) for cards, elevated plum-charcoal (`#201b29`) for raised controls, electric violet (`#8b5cf6`) for primary actions, warm amber (`#f4c95d`) for secondary emphasis, and pink (`#ec4899`) for sparse progress and category accents.
- Use typography, spacing, iconography, and a small number of layered surfaces for hierarchy. Use rounded cards with quiet borders and selective accent glow; avoid dense dashboard chrome and heavy glass blur.
- Keep Light, Forest, Violet, and Blueprint selectable. They keep their identities while receiving shared card, navigation, button, focus, and responsive styling through theme tokens.
- New users land on the Life overview, presented as **Dashboard**. Existing saved routes including Tasks continue to open as saved.
- Add a visible **Create** action in the app header that opens the existing quick-capture dialog. Keep `Ctrl+Shift+K` and `Ctrl+K` behavior intact.
- Compose the dashboard with these ten selected features:
  1. Today summary cards for planned, due-today, completed-today, and calendar-event counts.
  2. A day agenda combining imported events with scheduled task blocks.
  3. A focus queue showing up to three open My Day tasks with quick completion actions.
  4. Goal progress rings based only on completed linked tasks divided by open-plus-completed linked tasks; cancelled tasks do not count.
  5. Project cards with open-task counts and the next task for projects that have open work.
  6. Weekly completion bars showing real completed-task counts for the previous seven local days, including today.
  7. Routine launch tiles that add an existing routine to My Day.
  8. Pinned notes, with up to three user-pinned journal entries sorted by most recently updated.
  9. Upcoming life-admin items: due tasks and calendar events over the next seven local days.
  10. A customization panel that lets users reorder or hide dashboard cards.
- The stable widget IDs are `today-summary`, `agenda`, `focus`, `goals`, `projects`, `weekly-completions`, `routines`, `pinned-notes`, and `upcoming`. Keep the summary card visible and fixed first; users can reorder or hide the other eight.
- Dashboard customization is device-local, stored in browser local storage under `lifeassist-dashboard-layout-v1` and is not part of encrypted folder sync.
- `isPinned` is a boolean on journal entries. Existing entries migrate to `false`; pin changes update the journal row’s `updated_at` so encrypted folder sync carries them.
- If data is absent, show useful empty states. Never synthesize streaks, forecasts, app-wide scores, or user identity.
- At widths below 700 CSS pixels, dashboard cards stack into one column and primary actions remain visible without horizontal scrolling. Keep visible keyboard focus and honor reduced-motion preferences.

## Implementation subprojects and order

1. [Core dashboard and visual refresh](2026-11-12-lifeassist-dashboard-core.md) — theme, shell, existing-data widgets, and responsive dashboard.
2. [Weekly completion widget](2026-11-12-lifeassist-weekly-progress.md) — local-date aggregation and the seven-day bar card.
3. [Pinned journal notes](2026-11-12-lifeassist-pinned-notes.md) — SQLite migration, IPC, encrypted sync, and dashboard card.
4. [Dashboard customization](2026-11-12-lifeassist-dashboard-customization.md) — local widget visibility and ordering.

## Global constraints

- Preserve the five existing theme IDs: `midnight`, `light`, `forest`, `violet`, and `blueprint`.
- Keep existing task, goal, project, routine, calendar, and assistant data formats unchanged; add only the journal `is_pinned` boolean with a `false` migration default.
- Keep navigation view IDs unchanged; saved routes remain valid.
- Do not display invented names, avatars, notification counts, integrations, streaks, forecasts, app-wide scores, or unsupported percentages.
- Calculate goal progress only as completed linked tasks divided by open-plus-completed linked tasks; exclude cancelled tasks and label zero-task goals as “No linked tasks yet.”
- Count completed tasks by the user’s local calendar date; do not count cancelled tasks as completions.
- Preserve encrypted folder sync compatibility; existing snapshots without `is_pinned` restore with pin state `false`.
- Store widget layout locally with the exact key `lifeassist-dashboard-layout-v1`; do not add it to account sync or database backups.
- Keep the desktop app usable at `880×620`; below `700px` content width, stack dashboard cards into one column without horizontal scrolling.
- Honor `prefers-reduced-motion` and retain visible keyboard focus for interactive controls.
