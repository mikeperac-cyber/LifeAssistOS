# Sidebar, Chat, and Settings Redesign

**Date:** 2026-11-07
**Status:** Design specification
**Source:** Mike Assist redesign request and the two attached UI references.

## Goal

Give Chat more room, make its composer easier to scan, and group Memory with Settings while preserving Mike Assist's current chat, provider, voice, and memory behavior.

## Requirements

### Sidebar open and closed states

- Put the accessible close button at the outer edge of the open sidebar header, at the position marked in reference image 1. When the sidebar is closed, show its reopen button at the start of the main header.
- The sidebar starts open. The button closes the full sidebar to give the current view more width and reopens it on demand.
- Persist the last open/closed choice in renderer local storage under `mike-assist-sidebar-open`. Missing, invalid, or unreadable storage defaults to open.
- Render only one toggle at a time. Expose its state with the names “Collapse sidebar” and “Open sidebar”, plus matching `aria-expanded` and `aria-controls` values.
- Keep the sidebar navigation and its local state mounted while closed so reopening does not discard search or shortcut choices.

### Chat history placement

- Move the existing Recent chats disclosure from the bottom of the sidebar to directly below the Chat navigation button.
- Start the disclosure closed so it does not take space until requested.
- Preserve chat search, the current eight-session preview cap, active-session indication, empty states, and disabled switching while a task is running.

### Chat composer

- Follow reference image 2's two-level layout: a roomy prompt field above a compact toolbar inside one rounded, bordered composer.
- Keep image attachment, chat mode, provider and model selection, model refresh, response effort, voice recording and voice mode, queued-task action, send, and stop controls available.
- Keep the configured provider/model values and current action behavior. Do not change prompt submission, attachment, voice, or task-queue semantics.
- Keep the layout usable at narrow widths and retain visible focus, disabled, loading, error, and setup-required states.

### Memory under Settings

- Remove Memory as a standalone sidebar destination and make it a section inside Settings.
- Settings opens on General by default and provides General and Memory sections, showing one section at a time.
- Opening Settings through ordinary navigation selects General; a Memory-specific link selects Memory.
- Global memory search results, Chat memory citations, and integration links that target Memory open Settings on its Memory section.
- Expose the selected Settings section through accessible button state.
- Reuse the existing Memory view and its local database. Preserve save approval, search, edit, archive, delete confirmation, and citation behavior; do not migrate or rewrite saved facts.

## Acceptance checks

1. The sidebar can be closed and reopened from the main header, remembers its choice after a reload, and the view fills the available space when it is closed.
2. Recent chats appears immediately under Chat, remains collapsed initially, and still searches and opens the same sessions under the existing busy-state rules.
3. The composer places the prompt above its actions, adapts to narrow widths, and retains its existing controls and keyboard behavior: Enter submits and Shift+Enter inserts a newline.
4. Settings shows General or Memory as the selected section. Memory links from global search, Chat citations, and integrations open the Memory section without creating a separate Memory navigation page.
5. Existing memory records and all current approval and confirmation boundaries remain unchanged.

## Out of scope

- Backend, IPC, database schema, permission policy, provider configuration, and stored conversation or memory data changes.
- Replacing or removing provider, model, response-effort, attachment, voice, or queue capabilities.
- Copying the sample prompt or a specific provider/model label from the visual references.
