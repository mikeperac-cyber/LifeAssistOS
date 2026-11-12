# LifeAssistOS Core Dashboard

## Goal

Refresh the app shell and Life overview into a card-based dashboard with the reference’s dark/violet visual direction.

## Requirements

- Midnight tokens: `--bg #0b0910`, `--panel #15121b`, `--panel-2 #201b29`, `--accent #8b5cf6`, `--amber #f4c95d`, and `--pink #ec4899`. Define matching RGB tint tokens; define pink values for every other theme.
- New users default to the Life view presented as **Dashboard**. Existing saved routes and view IDs remain unchanged.
- Place **Create** in the app header; it opens the existing quick-capture dialog.
- Build data-backed cards for Today summary, day agenda, focus queue, goal progress, project progress, routines, and upcoming life-admin items. Weekly progress and pinned notes are separate subprojects.
- Focus queue is the first three open My Day tasks in saved day order. Quick completion uses the existing task update IPC.
- Goal progress is completed linked tasks divided by open-plus-completed linked tasks; cancelled tasks do not count. Show “No linked tasks yet” when the denominator is zero.
- Project cards appear only for projects with open tasks and show open-task count and the next task in their current task order.
- Upcoming life admin includes open tasks due today through six days ahead and imported calendar events whose time range overlaps the same date range.
- Keep a concise empty state per card, with a next action that routes to the existing feature.
- Respect the 700px one-column breakpoint, `880×620` desktop minimum, visible focus, and reduced motion.

## Global constraints

- Preserve the five theme IDs and existing route IDs.
- Do not change task, goal, project, routine, calendar, journal, or assistant data formats in this subproject.
- Use only stored task, goal, project, routine, and imported calendar data; add no fabricated identity or metrics.
- Keep the app usable at `880×620`; below `700px` content width, use one dashboard column without horizontal scrolling.
- Honor `prefers-reduced-motion` and visible keyboard focus.
