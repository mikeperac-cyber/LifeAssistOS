# Mike Assist

Mike Assist is a local-first to-do app with optional AI assistance. Capture tasks, organize the day, and use AI to turn rough notes into editable task suggestions. Your local task list works without an AI provider.

## Tasks and workflow

- Capture thoughts in the Inbox and turn them into tasks when you are ready.
- Organize work in Today, Upcoming, Completed, and Archived views; search task titles and notes.
- Add priorities, due dates, one-time reminders, notes, and one level of subtasks.
- Ask AI to draft a task from rough notes, break a task into subtasks, or propose an ordered plan for today.
- Review and edit every AI suggestion before saving. AI never changes tasks on its own.
- Use the system tray or `Ctrl+Shift+K` to capture a thought quickly.

## AI provider setup

Open **Settings → AI provider** to choose a hosted provider, Ollama, LM Studio, or a custom OpenAI-compatible endpoint. Enter the endpoint, model, and API key if the provider requires one. Use **Test connection & load models** to check the configuration.

Provider settings and the existing encrypted API-key format remain in `%APPDATA%\Mike Assist\settings.json`. Windows `safeStorage` encrypts the key when available. If secure storage is unavailable, the key is kept for the current app session and must be entered again after a restart.

AI is optional. When using a hosted provider, Mike Assist sends the text and task details shown for the chosen AI action. The API key stays in the main process and is never returned to the renderer. A local Ollama or LM Studio endpoint can keep those requests on this device.

## Reminders and backups

One-time reminders use Windows notifications while Mike Assist is running. If a reminder becomes due while the app is closed, it appears once after the app starts again.

Open **Settings → Local backup & restore** to save your task database and settings. An optional passphrase encrypts the backup. The app can restore the current backup format and task data from older full-assistant backups; unrelated files from older installations remain in the existing user-data folder.

The installer keeps the same app identity and user-data location. Uninstalling Mike Assist does not remove `%APPDATA%\Mike Assist`, so tasks and provider settings remain available when you reinstall.

## Development

```powershell
npm install
npm run dev
npm run typecheck
npm test
npm run build
npm run dist:win
```

The Windows installer is written to `release\Mike-Assist-Setup-0.1.0.exe`. No signing certificate is included, so Windows may show a SmartScreen warning.

## Product roadmap

The staged work-management recommendations are in [the roadmap proposal](docs/superpowers/specs/2026-11-08-work-management-roadmap.md). The next recommended addition is **My Day**: let users select and reorder planned tasks without changing their due dates, while keeping overdue and due-today tasks visible. Later options include lightweight Areas and projects, a List/Board switch, recurring routines, reviewed AI Inbox triage, weekly review, and a small action-focused productivity overview.

Keep the everyday task screen simple. The roadmap defers capacity charts until task duration estimates exist, and avoids productivity scores, streaks, and unqualified on-time rates.
