# LifeAssistOS

<div align="center">

### A calmer place to plan your day and keep life moving.

Capture what’s on your mind, turn it into clear next steps, and connect daily work to the goals that matter. LifeAssistOS is a local-first Windows productivity app with optional AI support.

**Tasks · Projects · Goals · Routines · Journal · Calendar · AI coaching**

</div>

---

## Make progress feel manageable

LifeAssistOS brings the pieces of a productive day into one focused workspace. Start with a quick capture, decide what matters today, and keep your bigger plans close without turning every part of life into a score.

| Plan | Connect | Reflect |
| --- | --- | --- |
| Inbox, My Day, projects, boards, priorities, reminders, and recurring tasks | Goals, reusable routines, journal notes, and a calendar-aware day agenda | A private weekly review with recent completions and focused task filters |

## What you can do

- **Shape your day.** Capture ideas in the Inbox, choose a focused My Day list, and see overdue and due-today work alongside your schedule.
- **Move projects forward.** Group work into Areas and projects, then use List or Board views to track what’s next, in progress, or waiting.
- **Build routines that stick.** Repeat tasks daily, on chosen weekdays, or monthly. Reuse checklist templates for the workflows you do often.
- **Keep life connected.** Link goals to Areas and projects, write searchable notes and journal entries, and bring read-only calendar events into your agenda.
- **Get useful AI help.** Ask for a draft task, subtasks, or a suggested day plan. Review every suggestion before saving or applying it.
- **Choose a workspace that feels right.** Switch between Midnight, Light, Forest, Violet, and Blueprint themes. Use `Ctrl+K` to jump to a view or capture an item.

## Your data stays yours

Your tasks and life workspace are stored locally. AI features are optional; when you use a hosted provider, LifeAssistOS sends only the information needed for that action. Personal context and open tasks each have their own sharing controls. API keys stay in the main process and are encrypted with Windows secure storage when available.

Back up your workspace from **Settings → Local backup & restore**, with optional passphrase encryption. For multiple devices, choose a folder already synchronized by your cloud-storage provider and enable **Encrypted folder sync**. Devices exchange AES-256-GCM encrypted snapshots; each device’s provider credentials and appearance remain local.

Calendar support currently imports read-only `.ics` files from Google Calendar or Outlook. LifeAssistOS does not connect to those calendar accounts directly.

## AI providers

Use OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, DeepSeek, Mistral, xAI, NVIDIA, Together AI, Fireworks AI, Cerebras, Ollama, LM Studio, or a custom OpenAI-compatible endpoint. Local Ollama and LM Studio setups can keep AI requests on your device. AI output is a draft: it never changes your tasks without your review.

## Install on Windows

Download **LifeAssistOS-Setup-0.3.0.exe** from the project’s GitHub Releases page and run the installer. LifeAssistOS can be installed per user and does not require administrator access. The installer preserves your existing workspace when upgrading or reinstalling.

Windows may show a SmartScreen prompt because this build is not code-signed. Confirm the publisher details and continue only if you downloaded the installer from the project’s GitHub Releases page.

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

The Windows installer is written to `release\LifeAssistOS-Setup-0.3.0.exe`.

## Product direction

LifeAssistOS aims to be a practical life workspace: useful enough to connect plans, routines, and reflection, while keeping everyday task planning quick and private by default. See the [work-management roadmap](docs/superpowers/specs/2026-11-08-work-management-roadmap.md) for the product rationale and deferred ideas.
