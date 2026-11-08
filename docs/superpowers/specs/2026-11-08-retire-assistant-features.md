# Assistant Feature Retirement and Reinstall Spec

## Goal

Remove the general-purpose assistant product surface and its unused runtime code, leaving a focused to-do app with the current AI provider configuration intact.

## Keep

- Electron app shell, React renderer, typed preload boundary, SQLite task/Inbox store, reminder scheduler, provider implementations and presets, provider test action, provider settings UI, `SettingsStore`, and Electron `safeStorage` API-key encryption.
- Existing local backup and restore support.
- Existing provider preset catalog, settings-file version, credential identity mapping, and encrypted ciphertext format.
- The current product name `Mike Assist`, app ID `com.mikeassist.desktop`, and per-user data path.
- Existing provider configuration and encrypted key ciphertext, existing task rows, and Inbox rows.
- Existing non-task database files during uninstall. Feature removal must not silently erase user data.

## Retire

Remove Chat and agent modes; tool gateway and approvals; code and browser execution; local API server; conversation history; memory; finance; coaching; research and Knowledge Vault; teaching packs; email and cloud-file views; calendar and connected task providers; MCP; workflows; skills; scheduled agent runs; delegation; and the general integrations/activity/audit screens. Remove only code and dependencies that have no remaining to-do, backup, reminder, or provider-setting use.

## Installation behavior

- Keep `productName`, `appId`, and NSIS `deleteAppDataOnUninstall: false` stable.
- Build the new Windows NSIS installer, uninstall the existing installed build, then install and launch the rebuilt app.
- Verify that the existing provider is still selected and its key is reported as stored without displaying or logging the key; verify existing tasks and Inbox entries are present.
- If local OS-backed encryption cannot decrypt the old key, preserve its ciphertext and show the existing recoverable credential error path rather than overwriting it. If the current session-only fallback is active because OS encryption is unavailable, the key cannot survive an app restart and may need to be entered again.
