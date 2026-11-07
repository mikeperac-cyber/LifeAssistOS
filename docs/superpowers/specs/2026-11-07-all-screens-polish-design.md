# All-Screen UI Polish

**Date:** 2026-11-07  
**Status:** Draft for user approval  
**Source:** User request to make every screen cohesive, fill the workspace appropriately, and feel easier to use, with the supplied sidebar and chat references. The user selected the native approach and asked to keep code changes necessary and careful.

## Intent

Mike Assist already has a consistent light/dark token system and a shared Electron shell, but routed screens use different content widths, spacing, and empty-space behavior. Some pages feel constrained within the large main pane, while a few views are intentionally dense or full-width. Make the app feel like one polished product without flattening useful differences between Chat, dashboards, editors, and settings.

The primary audience is Mike using the desktop app across ordinary Windows window sizes. Success means each route has a clear hierarchy, uses the available workspace sensibly, remains readable, and presents loading, empty, error, and action states in a consistent way.

## Current Project Context

- The app is a native Electron renderer built with React and CSS. It has no `components.json`, Tailwind config, or installed shadcn component package.
- The main shell and routed view selection live in `src/renderer/src/App.tsx`; view-specific markup lives in `src/renderer/src/components/` and styles primarily live in `src/renderer/src/styles.css` plus `styles/domains.css`.
- The renderer already uses CSS variables for themes and container queries for the main content area. Keep these patterns and extend them where they solve the current sizing differences.
- The existing sidebar collapse/reopen, Recent chats placement, chat composer layout, and Settings General/Memory navigation are already present from the earlier redesign. Treat that behavior as established; this project should polish it in context, not reimplement it.
- The current views include Chat, Today, Email, Cloud Files, Scheduled, Coach, Work, Integrations, Research, Vault, Teaching, Finances, Workflows, Skills, Activity, and Settings with General and Memory sections. Search, Quick capture, and approval dialogs are shared overlays.
- The shadcn skill was requested, but its component workflow does not apply directly to this repo. Use its consistency, semantic-token, accessible-composition, and reuse principles without initializing shadcn, adding Tailwind, or installing a component library.

## Goals

1. Give every routed screen the same underlying page rhythm: clear top-level hierarchy, predictable responsive gutters, intentional scroll ownership, and consistent card and form spacing.
2. Use wide desktop workspace space for dashboards, grids, lists, and split panes. Keep focused reading and editing surfaces intentionally capped when more width would harm legibility.
3. Make empty, loading, error, success, and setup-required states look deliberate and consistent without hiding useful detail or controls.
4. Preserve each screen's identity and existing functionality while improving balance, density, and scanability.
5. Respect the existing theme tokens, accessible semantics, keyboard behavior, and permission boundaries.

## Non-Goals and Anti-Goals

- Do not migrate the app to shadcn, Tailwind, Radix, or another component framework.
- Do not redesign provider behavior, navigation semantics, stored data, IPC, permissions, approval gates, or integration flows.
- Do not add a new dashboard, analytics feature, or data visualization solely to occupy blank space.
- Do not force every page to full-bleed width or apply one maximum width to every content type.
- Do not make the app denser by shrinking text, controls, or focus targets.
- Do not replace working page structures just to achieve code abstraction; reuse current markup and styles unless a small shared layout primitive clearly removes real duplication.

## Constraints

- Keep the current native Electron, React, TypeScript, and CSS implementation.
- Reuse current CSS variables and theme support; new raw colors should not be introduced for routine surfaces.
- Prefer changes to existing page styles and small shared layout helpers over new dependencies or large component rewrites.
- Preserve all current actions and their loading, disabled, confirmation, and error behavior.
- User requested terminal-only work for the reinstall task; do not use desktop UI automation in this project continuation.

## Approaches Considered

### 1. Native shared page system with focused view adjustments — selected

Set consistent page-level spacing and responsive width tiers in the existing CSS, then tune each route's layout and empty states where the current width or density is visibly wrong. Reuse existing page components and semantic theme variables. This follows the user's native-approach choice, fits the current codebase, and minimizes migration risk and unnecessary code.

### 2. Migrate to shadcn/Tailwind

Would provide a larger off-the-shelf component vocabulary, but this project has no shadcn setup and already has a native design-token system. It adds migration and dependency work unrelated to the visual inconsistencies and conflicts with the user's native-approach choice.

### 3. Tune every page independently

Would make local changes easy to target, but would preserve the current mismatch in gutters, card rhythm, and responsive behavior and likely create more duplicated CSS. It does not address the request for product-wide cohesion.

## Design Direction

Keep the existing visual language: calm light/dark surfaces, restrained teal accent, clear borders, rounded cards, readable Segoe UI typography, and compact but accessible desktop controls. Define a small set of shared width intents rather than a single page width: wide workspace for dashboards and card grids, standard workspace for split panes and forms, and reading width for transcript or long-form text. Use the main content container's available width so the sidebar's open or closed state is naturally respected.

At desktop sizes, pages should fill the main content height when their structure benefits from it; internal panes should scroll only when necessary. On narrower windows, grids should collapse by available container width, not just the overall window width. Keep at least one clear page heading hierarchy: the shell title remains primary, and an inner title should only repeat when it labels a distinct subtask or section.

### Screen-by-Screen Requirements

| Screen | Direction |
| --- | --- |
| Shared shell and sidebar | Preserve the existing pin/collapse control, Recent chats under Chat, and the current navigation. Align the shell title, view content top edge, content gutters, loading notices, and alert spacing across routes. When the sidebar is collapsed, content should use the released width without leaving an old fixed-width gutter. |
| Chat | Preserve the two-level composer and every provider, mode, model, effort, attachment, voice, queue, send, stop, and keyboard behavior. Give the transcript a comfortable reading width and the composer enough width to keep its control row orderly at common desktop sizes. Keep the new-chat setup/empty state balanced and responsive. |
| Today | Keep tasks and inbox as the primary scan targets. Group connected-service panels into a clear dashboard rhythm so integrations remain available without reading as an unrelated long stack. Preserve all sync, task, calendar, mail, and meeting actions. |
| Work | Keep the existing hero and tool-card grid, aligning its gutters, section labels, card heights, and responsive breakpoints with the shared system. Avoid a structural rewrite where the page is already balanced. |
| Coach | Preserve the personal/business tabs, reflection, goals, milestones, and saved journal behavior. Balance the form and goals columns at desktop widths and let saved entries use the available width when that improves readability. |
| Email | Expand the narrow provider/search surface into the standard workspace width. Align provider account controls, search controls, boundary notice, results, and empty states as one view while preserving private-by-default behavior. |
| Cloud Files | Expand the provider/search/reader layout into the standard workspace width. Let the file list and reader share available space proportionally; make connection and first-search states feel like part of the same page. |
| Scheduled | Use a wide workspace for the schedule form and routine cards, with a responsive grid and clear enabled/paused/running states. Keep run/remove confirmation and scheduling behavior unchanged. |
| Integrations | Use the wide workspace for provider cards, with columns chosen from available width so cards remain readable. Keep status, setup, and Memory links visible and preserve current connection actions. |
| Research | Preserve the project list plus research workspace split. Use available width and height effectively, keeping the project form, source/result details, and no-project state balanced. |
| Knowledge Vault | Preserve search/list and editor split. Let the editor occupy remaining width and height while keeping document text readable; make the no-selection state intentional rather than leaving an unfinished-looking editor area. |
| Teaching | Expand the teaching-pack grid into the wide workspace and use columns that fit the number and width of cards. Keep pack steps and Start in chat action easy to scan. |
| Finances | Use a wide ledger/dashboard workspace for period controls, import/export/add actions, and transactions. Give empty, loading, and error states a deliberate layout that uses the page area without inventing data. |
| Workflows | Preserve starter workflows and saved workflows. Keep the existing wide card grid and align its headings, statuses, action groups, and saved-empty state with the shared spacing. |
| Skills | Keep the searchable skill list and editor split, but make the empty editor and first-skill path intentional. Let both panes use desktop height and collapse cleanly at narrower widths. |
| Activity | Keep integrity status and the full audit timeline. Constrain very long row text for reading while using most of the workspace; preserve export and integrity details. |
| Settings — General | Keep the existing settings controls and Memory section toggle. Make settings groups easier to scan and avoid a narrow, unnecessarily long single column when the content can safely use a balanced grid. |
| Settings — Memory | Preserve save/search/edit/archive/delete/citation behavior and the existing database. Match settings page gutters and empty/archive states; ensure the active fact list and editor/search areas remain readable at narrow widths. |
| Search, Quick capture, approval dialogs | Keep current flows and permission semantics. Align dialog widths, headings, action placement, focus, loading, and error treatment with the shared visual language without making approval prompts less explicit. |

## Accessibility and Interaction

- Keep semantic headings, labels, button names, dialog titles, and keyboard focus visibility.
- Preserve keyboard shortcuts and composer behavior, including Enter to send and Shift+Enter for a new line.
- Keep accessible status/error announcements and disabled states for every async action.
- Ensure grid and pane reflow does not reorder content in a way that changes task or approval priority.

## Acceptance Checks

1. Every route listed above has a deliberate content width, hierarchy, and vertical behavior; no view is constrained by a stale width or has blank space that reads like a layout bug.
2. Wide screens use the available main pane for dashboard/grid/split-pane content, while transcript and long-form text retain comfortable line lengths.
3. Layouts reflow when the sidebar opens or closes and at narrower desktop widths, without horizontal overflow or clipped controls.
4. Loading, empty, error, success, setup-required, disabled, and confirmation states remain understandable and visually consistent.
5. All existing page actions, data, provider setup, navigation, keyboard interactions, and approval gates remain intact.
6. Both supported theme modes retain sufficient contrast using the existing design tokens.

## Left to the Builder

- Establish the smallest useful shared page-width/spacing rules and apply them to existing view classes.
- Adjust individual breakpoints and grid column counts from the actual minimum card and control widths.
- Make modest page-specific spacing, alignment, or empty-state adjustments only where they address an identified rough edge.
- Keep behavior changes out of scope unless required to preserve responsive accessibility; if a proposed change would alter user workflow or semantics, return for approval.
