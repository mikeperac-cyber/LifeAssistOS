# Sidebar, Chat, and Settings Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Chat more room, reshape its composer to match the supplied reference, and make Memory a section of Settings without changing existing data or action behavior.

**Architecture:** Keep the redesign in the React renderer. App owns the persisted sidebar visibility and Settings section routing; Sidebar owns navigation presentation and the Recent chats disclosure; ChatView keeps composer behavior while its markup and styling are reorganized; SettingsView hosts the existing MemoryView behind a General/Memory section switch.

**Tech Stack:** Electron, React 19, TypeScript 5.9, Vitest 5, and the existing renderer CSS.

**Spec:** `docs/superpowers/specs/2026-11-07-sidebar-chat-settings-redesign.md`

## Global Constraints

- The sidebar starts open and persists its choice under `mike-assist-sidebar-open`; unreadable or invalid storage defaults to open.
- Recent chats sits directly below Chat, starts closed, and retains the eight-session preview cap, search, active-session indication, and busy-state switching restriction.
- Enter submits a chat prompt; Shift+Enter inserts a newline.
- Keep existing image limits, provider/model behavior, response-effort selection, local voice behavior, queue controls, and approval boundaries.
- Memory stays on this device; preserve save approval, edit/archive behavior, delete confirmation, search, citations, and all existing records.
- Treat the current modified source tree as user-owned. Stage only changes from this redesign if a later implementation is explicitly committed.

## Review Focus

- Missing, malformed, or unavailable local storage must leave the sidebar open without breaking startup. Pin this to Task 2's normalization test and storage fallback check.
- A 520px-wide window must retain a visible open/close control and usable main content in both sidebar states. Pin this to Task 2's narrow-window manual check.
- Empty history, long chat titles, active-session display, and a busy task must preserve the existing history behavior. Pin this to Task 2's history manual check.
- Empty text, image-only drafts, setup-required state, busy state, and attachment preparation must keep Send enabled or disabled correctly. Pin this to Task 3's composer unit tests.
- Memory links from global search, Chat citations, and integrations must land on Settings → Memory. Pin this to Task 1's route tests and navigation manual check.

---

## File Structure

- `src/renderer/src/navigation.ts` — define sidebar visibility and Settings section types/helpers; remove Memory from standalone navigation metadata and route Memory integration targets to Settings.
- `src/renderer/src/App.tsx` — own persisted sidebar visibility, place the toggle in the main header, and route Memory entry points to Settings → Memory.
- `src/renderer/src/components/Sidebar.tsx` — place Recent chats under Chat and preserve its current list behavior.
- `src/renderer/src/components/SettingsView.tsx` — add General and Memory section controls and host the existing MemoryView.
- `src/renderer/src/components/MemoryView.tsx` — retain the existing local memory operations and UI; reuse it without changing storage behavior.
- `src/renderer/src/components/ChatView.tsx` — reorder the existing prompt and control markup into the reference's two-level composer.
- `src/renderer/src/components/chat-composer.ts` — provide the small pure Send-state helper used by ChatView and its unit tests.
- `src/renderer/src/styles.css` — style sidebar visibility, nested chat history, section controls, and the responsive composer.
- `tests/navigation.test.ts` — pin sidebar preference normalization and Memory routing.
- `tests/chat-composer.test.ts` — pin Send availability for prompt, attachment, setup, and busy states.

## Tasks

### Task 1: Move Memory into Settings

**Files:**
- Modify: `src/renderer/src/navigation.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Modify: `src/renderer/src/components/SettingsView.tsx`
- Modify: `src/renderer/src/styles.css`
- Test: `tests/navigation.test.ts`
- Reuse without changing storage behavior: `src/renderer/src/components/MemoryView.tsx`

**Interfaces:**
- Produces `type SettingsSection = 'general' | 'memory'` and `resolveSettingsSection(destination: string): SettingsSection` in `navigation.ts`.
- `resolveSettingsSection('memory')` returns `'memory'`; every other destination returns `'general'`.
- `resolveIntegrationTargetView('memory')` returns `'settings'`.
- `SettingsView` receives `section: SettingsSection`, `onSectionChange: (section: SettingsSection) => void`, `memoryDisabled: boolean`, `memoryVersion: number`, `selectedMemoryFact: MemoryFact | null`, `selectedMemoryQuery: string | undefined`, `onClearSelectedMemoryFact: () => void`, and `onMemoryChanged: () => void`; it renders the existing MemoryView only when `section === 'memory'`.
- Import the `MemoryFact` type from `src/shared/types.ts` for the SettingsView props.
- App's `navigateToView(view: View): void` selects General whenever `view === 'settings'`. App's `openMemorySettings(): void` selects the Memory section and the Settings view.

- [x] **Step 1: Write the failing navigation tests** in `tests/navigation.test.ts`.

```ts
it('routes Memory integration targets to Settings', () => {
  expect(resolveIntegrationTargetView('memory')).toBe('settings')
})

it('opens Memory destinations as a Settings section', () => {
  expect(resolveSettingsSection('memory')).toBe('memory')
  expect(resolveSettingsSection('settings')).toBe('general')
})

it('does not expose Memory as a standalone navigation view', () => {
  expect(Object.hasOwn(VIEW_META, 'memory')).toBe(false)
  expect(NAV_GROUPS.flatMap((group) => group.items)).not.toContain('memory')
})

it('drops a saved standalone Memory shortcut after the navigation move', () => {
  expect(normalizeSidebarShortcuts(['memory', 'email'])).toEqual(['email'])
})
```

- [x] **Step 2: Run the focused tests and verify they fail** because Memory still resolves as a standalone view and the section helper is missing.

Run: `npm exec vitest run tests/navigation.test.ts`

Expected: FAIL on the new Memory routing assertions.

- [x] **Step 3: Define Settings routing in `navigation.ts`** by adding `SettingsSection`, `resolveSettingsSection`, removing Memory from `VIEW_META` and `NAV_GROUPS`, and mapping the Memory integration target to `'settings'`. Keep normalization of old saved shortcuts safe: removed Memory shortcuts are ignored by `normalizeSidebarShortcuts`. Remove the now-unused Memory icon branch from `Sidebar.tsx`.

- [x] **Step 4: Route Settings destinations in `App.tsx`** through `navigateToView(view)`: set General when opening the Settings view through Sidebar navigation, global view search, or a non-Memory integration link. Route global-search memory results, Chat citations, and the Memory integration target through `openMemorySettings()` so they select Memory.

- [x] **Step 5: Add General and Memory section buttons to `SettingsView.tsx`** and expose selection with `aria-pressed`. Pass the existing MemoryView props from App, remove App's standalone MemoryView branch and lazy import, and render the existing MemoryView only for the Memory section. Leave its data access, save approval, edit/archive logic, delete confirmation, and callbacks intact.

- [x] **Step 6: Add section-switch styling in `styles.css`** and keep the General Settings content in its existing scroll region. Ensure the Memory section uses the available Settings width without adding a new sidebar destination.

- [x] **Step 7: Run the focused navigation tests.**

Run: `npm exec vitest run tests/navigation.test.ts`

Expected: PASS.

- [x] **Step 8: Run the TypeScript check.**

Run: `npm run typecheck`

Expected: exits with code 0.

- [ ] **Step 9: Manually verify Memory routing and behavior** by opening a global memory search result, a Chat citation, and a Memory integration link; each must show Settings → Memory. Confirm existing active and archived facts remain present, then search, edit, archive, and delete a fact using the existing flows. Verify save still shows the existing approval card and delete still requires its current confirmation. Open Settings through ordinary navigation and confirm General is selected with its existing sections available.

- [ ] **Step 10: Commit only this task's changes** after checking the working tree and staging only its files/hunks.

### Task 2: Add the sidebar toggle and nest Recent chats under Chat

**Files:**
- Modify: `src/renderer/src/navigation.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Modify: `src/renderer/src/styles.css`
- Test: `tests/navigation.test.ts`

**Interfaces:**
- Produces `type SidebarVisibility = 'open' | 'closed'`, `SIDEBAR_VISIBILITY_STORAGE_KEY = 'mike-assist-sidebar-open'`, `normalizeSidebarVisibility(value: unknown): SidebarVisibility`, and `readSidebarVisibility(readStorageValue: (key: string) => string | null): SidebarVisibility` in `navigation.ts`.
- `normalizeSidebarVisibility('closed')` returns `'closed'`; all other values return `'open'`.
- `readSidebarVisibility` reads the exact storage key and returns `'open'` if the read throws.
- App initializes visibility from local storage and persists changes. Sidebar receives `sidebarVisibility: SidebarVisibility` and `onToggleSidebar: () => void`.
- Render one toggle at a time: a “Collapse sidebar” button at the outer edge of the open sidebar header, or an “Open sidebar” button at the start of `.topbar` while closed. Both use `aria-controls="app-sidebar"` and matching `aria-expanded` values.
- `Sidebar` remains mounted with `id="app-sidebar"`; closed styling hides it without removing its navigation state.

- [x] **Step 1: Write the failing visibility tests** in `tests/navigation.test.ts`.

```ts
it('normalizes saved sidebar visibility and defaults invalid values to open', () => {
  expect(normalizeSidebarVisibility('closed')).toBe('closed')
  expect(normalizeSidebarVisibility('open')).toBe('open')
  expect(normalizeSidebarVisibility(null)).toBe('open')
  expect(normalizeSidebarVisibility('pinned')).toBe('open')
})

it('defaults to open when local storage cannot be read', () => {
  expect(readSidebarVisibility(() => { throw new Error('storage unavailable') })).toBe('open')
})

it('reads the saved value using the sidebar storage key', () => {
  let requestedKey = ''
  expect(readSidebarVisibility((key) => { requestedKey = key; return 'closed' })).toBe('closed')
  expect(requestedKey).toBe(SIDEBAR_VISIBILITY_STORAGE_KEY)
})
```

- [x] **Step 2: Run the focused test and verify it fails** because the visibility helper is not defined.

Run: `npm exec vitest run tests/navigation.test.ts`

Expected: FAIL with `normalizeSidebarVisibility` missing.

- [x] **Step 3: Implement sidebar visibility storage helpers** in `navigation.ts` with the exact key and union type in the Interfaces block. `readSidebarVisibility` must catch a throwing storage reader and return `'open'`.

- [x] **Step 4: Add visibility state and safe persistence in `App.tsx`**. Initialize through `readSidebarVisibility((key) => window.localStorage.getItem(key))`, persist updates under the same key inside a `try/catch`, and pass `sidebarVisibility` and `onToggleSidebar` to Sidebar.

- [x] **Step 5: Add the reopen control and open/closed layout** in `App.tsx` and `styles.css`. Render the topbar “Open sidebar” button only while closed; apply the closed class so `.main` fills the space at desktop and narrow breakpoints. Preserve the current stacked navigation layout when open below 900px.

- [x] **Step 6: Add the sidebar close control in `Sidebar.tsx`** at the outer edge of the brand header. Show it only while open, label it “Collapse sidebar”, and set `aria-controls="app-sidebar"` and `aria-expanded="true"`.

- [x] **Step 7: Move the Recent chats `<details>` into the Chat navigation item** in `Sidebar.tsx`, directly after the Chat button. Remove the old bottom-of-sidebar instance. Leave its closed initial state, search handlers, eight-item slice, empty copy, active item, and disabled state unchanged.

- [x] **Step 8: Style the nested history and toggle states** in `styles.css`. Keep the history body hidden while its details element is closed and ensure the nested list scrolls within the available sidebar height.

- [x] **Step 9: Run the navigation tests.**

Run: `npm exec vitest run tests/navigation.test.ts`

Expected: PASS.

- [x] **Step 10: Run the TypeScript check.**

Run: `npm run typecheck`

Expected: exits with code 0.

- [ ] **Step 11: Manually verify layout and history** at 1280×800 and 520×800. Close and reopen the sidebar; reload and confirm the saved state. Confirm the view expands when closed, the correct toggle remains reachable in both states, Recent chats sits below Chat and starts closed, long titles truncate, search still filters, the selected chat is marked, and switching remains disabled during an active task. Set the stored value to an invalid string and confirm startup opens the sidebar.

- [ ] **Step 12: Commit only this task's changes** after checking the working tree and staging only its files/hunks.

### Task 3: Rebuild the chat composer around the prompt

**Files:**
- Create: `src/renderer/src/components/chat-composer.ts`
- Modify: `src/renderer/src/components/ChatView.tsx`
- Modify: `src/renderer/src/styles.css`
- Test: `tests/chat-composer.test.ts`

**Interfaces:**
- Produces `interface ComposerSubmissionState { providerSetupRequired: boolean; busy: boolean; preparingAttachments: boolean; input: string; pendingImageCount: number }` and `canSubmitComposer(state: ComposerSubmissionState): boolean` in `chat-composer.ts`.
- `canSubmitComposer` returns true only when setup is complete, the assistant is not busy, attachments are not being prepared, and either trimmed text or at least one image is present.
- ChatView uses `canSubmitComposer` for the Send button's disabled state; all other composer callbacks and data continue to use the current ChatViewProps.

- [x] **Step 1: Write the failing composer-state tests** in `tests/chat-composer.test.ts` for empty/whitespace drafts, text, image-only drafts, setup-required state, busy state, and attachment preparation.

```ts
const ready = {
  providerSetupRequired: false,
  busy: false,
  preparingAttachments: false,
  input: '',
  pendingImageCount: 0
}

it('allows text or an image only when chat is ready', () => {
  expect(canSubmitComposer({ ...ready, input: '  ', pendingImageCount: 0 })).toBe(false)
  expect(canSubmitComposer({ ...ready, input: 'Summarize this', pendingImageCount: 0 })).toBe(true)
  expect(canSubmitComposer({ ...ready, input: '', pendingImageCount: 1 })).toBe(true)
  expect(canSubmitComposer({ ...ready, busy: true, input: 'Hello', pendingImageCount: 0 })).toBe(false)
  expect(canSubmitComposer({ ...ready, providerSetupRequired: true, input: 'Hello', pendingImageCount: 0 })).toBe(false)
  expect(canSubmitComposer({ ...ready, preparingAttachments: true, pendingImageCount: 1 })).toBe(false)
})
```

- [x] **Step 2: Run the focused test and verify it fails** because the composer helper has not been implemented.

Run: `npm exec vitest run tests/chat-composer.test.ts`

Expected: FAIL with the helper module or function missing.

- [x] **Step 3: Implement `canSubmitComposer`** in `chat-composer.ts` and make ChatView use it for Send enablement, preserving the existing conditions.

- [x] **Step 4: Reorder the composer markup in `ChatView.tsx`** into a prompt row followed by a toolbar row. Put the textarea in the prompt row. Put image attachment, chat mode, provider/model and refresh, response effort, voice recording/mode, queue, send, and stop controls in the toolbar row. Keep attachment previews, setup-required link, status messages, help text, and existing event handlers.

- [x] **Step 5: Restyle the composer in `styles.css`** as one rounded, bordered panel with a spacious top prompt area and a compact lower toolbar. Keep the focus ring visible and use the existing theme variables. At narrow widths, wrap controls into readable rows without clipping model values or hiding actions.

- [x] **Step 6: Run the composer tests.**

Run: `npm exec vitest run tests/chat-composer.test.ts`

Expected: PASS.

- [x] **Step 7: Run the TypeScript check.**

Run: `npm run typecheck`

Expected: exits with code 0.

- [ ] **Step 8: Manually verify the composer** at 1280×800 and 520×800. Confirm Enter sends, Shift+Enter adds a line, image preview/removal works, provider/model and effort selectors remain available, voice modes remain selectable, and Send/Queue/Stop retain their existing disabled/loading behavior.

- [ ] **Step 9: Commit only this task's changes** after checking the working tree and staging only its files/hunks.

## Final Verification

- [x] Run: `npm test` — Expected: all Vitest tests pass.
- [x] Run: `npm run typecheck` — Expected: exits with code 0.
- [x] Run: `npm run build` — Expected: renderer and Electron bundles build successfully.
- [x] Review the final diff against the spec and confirm it contains no data, IPC, provider, or approval-policy changes.
