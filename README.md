# LifeAssistOS

<div align="center">

### Your day, your projects, and the rest of life in one calm workspace.

LifeAssistOS is a local-first Windows productivity app for turning loose thoughts into clear next steps, keeping projects moving, and staying connected to the goals behind your work.

[![Latest release](https://img.shields.io/github/v/release/mikeperac-cyber/LifeAssistOS?label=latest%20release&color=7c3aed)](https://github.com/mikeperac-cyber/LifeAssistOS/releases/latest)
[![Platform](https://img.shields.io/badge/platform-Windows-2563eb?logo=windows&logoColor=white)](https://github.com/mikeperac-cyber/LifeAssistOS)
[![AI optional](https://img.shields.io/badge/AI-optional-8b5cf6)](https://github.com/mikeperac-cyber/LifeAssistOS)

**Dashboard · My Day · Projects · Goals · Routines · Notes · Documents · Calendar · Optional AI**

</div>

---

## A clear view of what matters today

The Dashboard brings your real plans together without turning productivity into a score. See what you planned, what is due, completed work, and your imported calendar context at a glance.

- **Find your next step.** Keep up to three My Day tasks in a quick focus queue, with one-click completion.
- **See your progress.** Review real completions across the week, this month’s completed-task count, and progress rings based on linked goal tasks.
- **Keep work moving.** See tasks in progress, complete them from the Dashboard, or add a task without leaving the page.
- **Keep the bigger picture close.** Follow goal progress, see projects with open work, and jump to each project’s next task.
- **Make routines easy to start.** Add an existing routine to My Day when you are ready to begin.
- **Keep useful notes nearby.** Pin journal entries to the Dashboard and sync pin state through your encrypted folder.
- **Make it yours.** Reorder or hide Dashboard cards. Your layout stays on this device.

## One workspace, connected

| Plan | Build momentum | Reflect and reset |
| --- | --- | --- |
| Capture thoughts in the Inbox, choose a focused My Day list, and organize work by Area, project, priority, due date, or schedule. | Track project work in List or Board views, create reusable routines, and keep goals connected to your active tasks. | Search notes and journal entries, keep local document links nearby, bring read-only `.ics` calendars into your agenda, and use weekly review to choose the next step. |

AI support is optional. Ask for task drafts, subtasks, or a suggested day plan; review each suggestion before saving or applying it. Coach and Teacher modes support learning and everyday decisions without taking control of your workspace.

## Your data stays yours

Tasks and life-workspace records are stored locally. Documents keeps links to files you choose; it does not copy or change the originals. Document links stay on this device and are excluded from backups and encrypted folder sync. When you use a hosted AI provider, LifeAssistOS sends only the information needed for that action. Personal context and open tasks have separate sharing controls. API keys stay in the main process and are encrypted with Windows secure storage when available.

Create a local backup from **Settings → Local backup & restore**, with optional passphrase encryption. To sync devices, choose a folder already synchronized by your cloud-storage provider and enable **Encrypted folder sync**. Devices exchange AES-256-GCM encrypted snapshots; provider credentials and appearance remain local to each device.

Calendar support imports read-only `.ics` files from Google Calendar or Outlook. LifeAssistOS does not connect to those calendar accounts directly.

## Themes

Choose **Midnight**, **Light**, **Forest**, **Violet**, or **Blueprint**. Midnight uses a deep charcoal workspace with violet actions and restrained amber and pink accents.

## Install on Windows

Download the latest **LifeAssistOS** installer from [GitHub Releases](https://github.com/mikeperac-cyber/LifeAssistOS/releases/latest) and run it. The app installs per user and does not require administrator access. Upgrades and reinstalls preserve your existing workspace.

Windows may show a SmartScreen prompt because the build is not code-signed. Check that you downloaded the installer from this project’s [GitHub Releases page](https://github.com/mikeperac-cyber/LifeAssistOS/releases/latest).

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+K` | Open command search and navigation |
| `Ctrl+Shift+K` | Capture a thought quickly |

## Build from source

Requirements: Windows, Node.js `>=22.13.0`, and npm.

```powershell
npm install
npm run dev
npm run typecheck
npm test
npm run build
npm run dist:win
```

The Windows installer is written to `release\LifeAssistOS-Setup-0.4.1.exe`.

## Product direction

LifeAssistOS is designed to keep daily planning quick while connecting it to projects, routines, and reflection. See the [work-management roadmap](docs/superpowers/specs/2026-11-08-work-management-roadmap.md) for product rationale and deferred ideas.

