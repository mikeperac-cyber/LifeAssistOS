# To-do App Foundation Spec

## Goal

Rebuild Mike Assist as a local-first Windows to-do app with a calm, task-centered interface and reliable everyday task handling.

## Recommended feature priorities

1. Fast task capture into an Inbox, including the existing keyboard shortcut.
2. Today, Upcoming, Inbox, and Completed task views.
3. Due dates, priority, notes, completion, and one-time desktop reminders.
4. Subtasks for breaking work into manageable steps.
5. Search across task titles and notes.
6. AI capture, task breakdown, and daily planning are defined in the separate AI spec.

Projects and labels, recurring tasks, calendar sync, focus timer, and weekly review are good follow-up features. Keep them out of this first rebuild so the app stays quick to learn and easy to maintain.

For a staged proposal to add My Day planning, Areas/projects, workflow boards, recurring tasks, weekly review, and an evidence-based productivity overview, see `docs/superpowers/specs/2026-11-08-work-management-roadmap.md`. Those additions are not yet part of the implementation task checklists.

## Product behavior

- Tasks and the capture Inbox work offline and persist locally in SQLite.
- The main navigation contains Tasks and Settings. The Tasks view has Today, Inbox, Upcoming, Completed, and Archived filters.
- A task retains the current fields: title, notes, due date, reminder instant, priority, completion state, and timestamps. A task may have direct subtasks; subtasks cannot have children.
- Completing a parent does not automatically complete its subtasks; each task has its own completion state.
- Today includes open tasks due today, overdue tasks, and undated open tasks. Upcoming includes open tasks due after the local date. Completed shows done tasks. Archived shows cancelled tasks; they are hidden from Today and Upcoming. A child task keeps its own completion/archive state and remains independently filterable.
- Reminder notifications are local and continue to use the current reminder scheduler while the app is running.
- Keep the existing local backup and restore actions in Settings so users can protect their task data.
- Existing tasks and Inbox records remain readable after the additive subtask schema migration.
- The app remains useful when no AI provider is configured.

## Out of scope for the first rebuild

Projects, labels, recurrence, calendar synchronization, email and cloud connectors, finance, coaching, research, knowledge vault, chat history, code execution, browser automation, MCP, user skills, scheduled agent runs, and general-purpose workflows.

## Product constraints

- Keep the product name and app identity `Mike Assist` during the rebuild so existing per-user application data remains at the same location.
- Do not delete existing task or Inbox rows during migration.
- Use the existing Electron, React, TypeScript, SQLite, and Windows NSIS stack.
