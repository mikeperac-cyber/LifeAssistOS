# Retire Assistant Features and Reinstall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the general-purpose assistant surface and dead runtime code, then replace the installed Windows app while preserving provider credentials and local tasks.

**Architecture:** Keep only the Electron shell, focused Tasks/Settings UI, provider configuration and request modules, typed task/AI IPC, SQLite task store, and reminders. Remove retired features from navigation, preload, main-process startup and IPC before deleting their orphaned implementations and dependencies; keep the existing app identity and user-data directory.

**Tech Stack:** Electron 45, React 19, TypeScript, SQLite, Electron `safeStorage`, NSIS, npm.

**Spec:** `docs/superpowers/specs/2026-11-08-retire-assistant-features.md`

## Global Constraints

- Retain `productName: Mike Assist`, `appId: com.mikeassist.desktop`, and NSIS `deleteAppDataOnUninstall: false`.
- Keep current provider presets, settings form, API-key ciphertext, settings file location, task/Inbox database, and reminder scheduler.
- Preserve the current provider preset catalog, settings schema, and encrypted-key migration; if `safeStorage` is unavailable, the existing session-only key must be entered again after restart.
- Never return or log plaintext API keys; renderer receives only `hasApiKey` and `apiKeyStored` flags.
- Do not erase old non-task databases during uninstall or feature removal.
- Uninstall the current installed build only after the new Windows installer has built successfully.

## Review Focus

- Existing encrypted API-key settings must remain decryptable and provider selection unchanged — test `test_existing_encrypted_provider_key_survives_settings_reopen` in Task 2.
- The renderer must never receive the API key when loading or updating settings — test `test_public_settings_never_include_api_key` in Task 2.
- Existing tasks and Inbox rows must remain after database reopen and reinstall — test `test_reopen_preserves_existing_tasks_and_inbox` in Task 2 and inspect the installed app in Task 3.
- A first launch without a configured API key must still allow local task CRUD — test `test_local_tasks_work_without_provider_credentials` in Task 1.
- Removing a feature must not leave stale renderer IPC or broken main startup imports — test `test_retired_ipc_and_startup_imports_are_absent` in Task 1, then run typecheck and build.

---

## File Structure

- Keep: `src/core/settings.ts`; `src/core/providers/anthropic.ts`, `factory.ts`, `ollama.ts`, `openai-compatible.ts`, and `types.ts`; `src/core/planning.ts`, `reminders.ts`, `backup.ts`, `json-store.ts`, and `sqlite.ts`; `src/shared/presets.ts`, `provider-endpoint.ts`, `date-only.ts`, and `search-normalization.ts`; `src/main/tray.ts`; and provider/task shared types.
- Simplify: `src/main/index.ts`, `src/main/ipc/domain-handlers.ts`, `src/preload/index.ts`, `src/shared/ipc.ts`, `src/shared/types.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/navigation.ts`, and `package.json` / `package-lock.json`.
- Under `src/renderer/src/components/`, delete `ActivityView.tsx`, `ApprovalModal.tsx`, `AuditView.tsx`, `CalendarEventsPanel.tsx`, `ChatView.tsx`, `CoachView.tsx`, `ConnectedEmailView.tsx`, `ConnectedFilesView.tsx`, `EmailFollowupPanel.tsx`, `FinanceView.tsx`, `GlobalSearchDialog.tsx`, `GoogleCalendarPanel.tsx`, `IntegrationsView.tsx`, `MarkdownMessage.tsx`, `McpPanel.tsx`, `MemoryView.tsx`, `MicrosoftCalendarPanel.tsx`, `MicrosoftMailSettingsCard.tsx`, `MicrosoftOneDriveSettingsCard.tsx`, `MicrosoftTodoPanel.tsx`, `RemoteTaskImportButton.tsx`, `ResearchView.tsx`, `ScheduledTasksView.tsx`, `SkillsView.tsx`, `TaskExportControl.tsx`, `TeachingView.tsx`, `TodayView.tsx`, `ToolCardView.tsx`, `VaultView.tsx`, `WorkflowsView.tsx`, and `WorkView.tsx`. Retain `AccessibleDialog.tsx`, `Sidebar.tsx`, `SettingsView.tsx`, `ProviderSettingsPanel.tsx`, `QuickCaptureDialog.tsx`, and the Todo components.
- Under `src/core/`, delete `agent.ts`, directories `agent/`, `audit/`, `gateway/`, and `mcp/`, plus `coaching.ts`, `conversations.ts`, `domain-allowlist.ts`, `file-checkpoints.ts`, `finance.ts`, `github.ts`, `google-calendar.ts`, `google-drive.ts`, `google-gmail.ts`, `google-oauth.ts`, `google-tasks.ts`, `grants.ts`, `image-attachments.ts`, `memory.ts`, `microsoft-calendar.ts`, `microsoft-mail.ts`, `microsoft-oauth.ts`, `microsoft-onedrive.ts`, `microsoft-todo.ts`, `notion.ts`, `registry.ts`, `research.ts`, `scheduled-tasks.ts`, `skills.ts`, `speech.ts`, `task-export-errors.ts`, `vault.ts`, `web-search-settings.ts`, and `workflows.ts`.
- Modify `src/core/planning.ts` to remove remote task import/export, email-follow-up, and calendar-preparation methods and public fields. Do not drop existing tables or legacy source columns; they remain untouched in old databases.
- Delete main/tool modules: `src/main/approval.ts`, `src/main/browser.ts`, `src/main/local-api-server.ts`, `src/main/pinned-https-proxy.ts`, `src/main/ipc/mutation-audit.ts`, and all files under `src/tools/`.
- Delete obsolete renderer helpers `src/renderer/src/global-search.ts`, `local-speech.ts`, `meeting-prep.ts`, `skill-learning.ts`, and `types.ts`. Delete obsolete shared helpers `src/shared/calendar-prep-input.ts`, `email-followup-input.ts`, `finance.ts`, `teaching.ts`, `today-calendar-export.ts`, and `workflow-params.ts`.
- Retain `tests/todo-planning.test.ts`, `tests/todo-view-model.test.ts`, `tests/todo-ai.test.ts`, `tests/todo-ai-ipc.test.ts`, `tests/todo-ai-ui-model.test.ts`, `tests/retired-features.test.ts`, `tests/navigation.test.ts`, `tests/settings.test.ts`, `tests/provider.test.ts`, `tests/llm-providers.test.ts`, `tests/reminders.test.ts`, `tests/backup.test.ts`, `tests/theme.test.ts`, `tests/tray-lifecycle.test.ts`, and a rewritten `tests/ipc-contract.test.ts`. Delete other tests that only exercise removed capabilities.
- Trim provider-exclusive dependencies from `package.json` and `package-lock.json` only after imports are gone; keep Electron, React, TypeScript, and Zod.

### Task 1: Remove retired runtime paths and dependencies

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/main/ipc/domain-handlers.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/core/planning.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Delete: renderer components, core modules, main services, and tools listed in File Structure once unreferenced.
- Delete: test files that cover only removed capabilities.
- Create: `tests/retired-features.test.ts`

**Interfaces:**
- Consumes: task and AI APIs from the foundation and AI plans.
- Produces: renderer IPC limited to task CRUD, reminders, provider settings/test, the three AI suggestion actions, and app lifecycle.

- [x] **Step 1: Write failing retirement contract tests**

Add `test_retired_ipc_and_startup_imports_are_absent` to assert no legacy feature appears in the retained `AssistApi` or main registration contract. Add `test_local_tasks_work_without_provider_credentials` against the task store.

- [x] **Step 2: Run targeted retirement tests and verify they fail**

Run: `npm test -- --reporter=verbose tests/retired-features.test.ts`
Expected: FAIL because legacy IPC members and startup imports remain.

- [x] **Step 3: Remove feature wiring, then orphaned modules**

Retain only the task/reminder, backup, provider, safeStorage, AI, app-window, tray, and installer paths. Remove retired IPC handlers, background services, implementation files, and exclusive dependencies. Keep the already simplified Tasks/Settings UI. Remove task integration methods from `PlanningStore` while leaving their existing SQL tables/columns untouched. Run `npm install` after editing manifests to synchronize `package-lock.json`.

- [x] **Step 4: Run focused tests, typecheck, and build**

Run: `npm test -- --reporter=verbose tests/retired-features.test.ts tests/settings.test.ts tests/provider.test.ts tests/todo-planning.test.ts tests/reminders.test.ts tests/backup.test.ts`
Expected: PASS for absence of retired runtime paths and retained functionality.
Run: `npm run typecheck`
Expected: PASS with no stale imports or IPC calls.
Run: `npm run build`
Expected: main, preload, and renderer bundles build successfully.

- [x] **Step 5: Commit the feature retirement**

```bash
git add -A src/main src/core src/preload src/shared src/renderer/src/components src/renderer/src/App.tsx src/renderer/src/navigation.ts src/tools tests package.json package-lock.json
git commit -m "refactor: retire general assistant features"
```

### Task 2: Verify settings and task compatibility

**Files:**
- Modify: `tests/settings.test.ts`
- Modify: `tests/todo-planning.test.ts`
- Modify: `src/core/settings.ts` only if a compatibility fix is required.
- Modify: `src/core/planning.ts` only if a compatibility fix is required.

- [x] **Step 1: Add legacy-provider and local-data compatibility tests**

Add `test_existing_encrypted_provider_key_survives_settings_reopen`, `test_public_settings_never_include_api_key`, and `test_reopen_preserves_existing_tasks_and_inbox`. Use a fake `SecretCodec`; assert stored ciphertext remains encrypted, the renderer-safe object has no `apiKey` property, and closing/reopening the task database preserves existing rows.

- [x] **Step 2: Run compatibility tests and verify they pass**

Run: `npm test -- --reporter=verbose tests/settings.test.ts tests/todo-planning.test.ts`
Expected: PASS with existing provider settings and task/Inbox rows intact.

- [x] **Step 3: Fix only compatibility regressions**

If a regression appears, keep the current settings-file version and encrypted-key migration path; keep old task rows and add only forward-compatible SQLite migrations. Do not clear ciphertext or replace the task database.

- [x] **Step 4: Re-run compatibility tests**

Run: `npm test -- --reporter=verbose tests/settings.test.ts tests/todo-planning.test.ts`
Expected: PASS.

- [x] **Step 5: Commit compatibility coverage**

```bash
git add tests/settings.test.ts tests/todo-planning.test.ts src/core/settings.ts src/core/planning.ts
git commit -m "test: preserve todo and provider data"
```

### Task 3: Build, uninstall, and install the focused app

**Files:**
- Use: `package.json` identity and NSIS settings.
- Modify: `README.md`
- Use: generated `release/Mike-Assist-Setup-<version>.exe`.

- [x] **Step 1: Update the README for the to-do product**

Replace the retired assistant feature catalog with setup steps for local tasks, reminders, AI provider configuration, backup/restore, and Windows installation. Keep the note that remote providers receive the text included in AI requests.

- [x] **Step 2: Build the Windows NSIS installer**

Run: `npm run dist:win`
Expected: installer is created in `release/` and NSIS still declares `deleteAppDataOnUninstall: false`.

- [x] **Step 3: Uninstall the currently installed Mike Assist build**

Close the app and run its existing per-user NSIS uninstaller. Expected: the installed program and shortcuts are removed; the Mike Assist user-data directory remains.

- [x] **Step 4: Install and launch the rebuilt app**

Run the newly built installer with the same per-user scope and install directory. Expected: the Tasks screen opens and Settings displays the existing provider as selected. When the prior key was encrypted with `safeStorage`, its stored indicator remains set; when the session-only fallback was active, Settings indicates that a key must be entered again.

- [x] **Step 5: Confirm preserved data without exposing secrets**

Confirm existing open/completed tasks and Inbox records load. Use the provider connection test only if explicitly configured by the user; never print, screenshot, or log the key. If the session-only encryption fallback is active, tell the user the key needs to be entered again after reinstall. Confirm no assistant-only routes or windows remain.

- [x] **Step 6: Commit the product documentation**

```bash
git add README.md
git commit -m "docs: describe focused todo app"
```
