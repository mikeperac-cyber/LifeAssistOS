# Work Management System Roadmap Proposal

This proposal expands the to-do rebuild into a lightweight work-management system while keeping the everyday task screen simple. My Day, All Tasks, Areas/projects, and recurring tasks are implemented; saved filters, templates, and later AI/productivity recommendations remain staged.

## Keep in the first rebuild

The existing plans already cover the right foundation: fast Inbox capture, due dates and one-time reminders, priorities, notes, subtasks, search, local storage and backup, plus AI-assisted task drafting, task breakdown, and a proposed plan for today. Preserve these as the smallest complete version of the product.

## Highest-value workflow additions

### 1. Separate today's plan from deadlines

- Add optional `plannedDate` and `dayOrder` fields to tasks. Keep `plannedDate` separate from `dueDate` so “I plan to do it today” does not falsely change a deadline.
- Add a My Day view for selected tasks and an All Tasks view so undated tasks remain findable without appearing in today's focused list.
- Keep genuinely overdue and due-today tasks visible in a separate “Due” section of the day view.
- Let users select, remove, and reorder today's work. Unfinished work stays in its current project and due date until the user moves it.
- Have AI propose a My Day selection and order; apply changes only after review and confirmation.

This is the best next workflow feature because it makes daily planning useful without conflating intention and obligation.

### 2. Add lightweight project management

- Add optional Areas (for example, Work, Personal, and Study) with projects beneath them. Keep Inbox capture and unassigned tasks first-class.
- Give projects a short description, target date, and sections. Avoid deep folder nesting.
- Offer List and Board views over the same tasks, with simple stages such as `Next`, `In Progress`, and `Waiting`.
- Keep workflow stage separate from lifecycle (`open`, `done`, `archived`) and from due date. A waiting task can still be open and overdue.
- Add reusable filters for project, stage, priority, and date; allow a user to save a few named views.

### 3. Add recurrence and reusable routines

- Support daily, weekly, selected weekdays, and monthly repeats with an optional end date.
- Completing an occurrence creates the next occurrence while retaining the completed task in history.
- Rescheduling or skipping one occurrence must not silently rewrite the repeat rule.
- Let users save a task and subtask set as a reusable checklist for routines such as lesson prep, weekly planning, or bill review.

**Status:** Recurring tasks are implemented with daily, selected-weekday, and monthly rules, inclusive end dates, skip-once, and history-preserving advancement. Saved task views are implemented locally with project, priority, workflow stage, and due-date filters, up to twelve named views, and per-view deletion. Reusable checklist templates remain future work.

These features bring dependable day-to-day management. Keep dependencies, Gantt charts, and complex custom fields out of this lightweight system.

## AI upgrades after the first three actions

The current AI plan has a good safety boundary: AI returns typed suggestions, and the user decides what to save. Build on it once project and workflow data exists:

- **Inbox triage:** suggest a project, stage, priority, and date; identify likely duplicate tasks. Show editable suggestions in a review queue.
- **Project kickoff:** turn a goal and target date into a proposed project outline with milestones and tasks. Require the user to select what to create.
- **Weekly review:** summarize overdue, waiting, unplanned, and recently completed work; suggest next actions and a draft plan for the coming week. Never move, archive, or reprioritize tasks without confirmation.
- **Task clarity check:** flag tasks that may be too vague and offer a more actionable title or first step.

For each AI action, show which task details will be sent to the configured provider, keep credentials in the main process, validate the response, and leave normal task management available when AI is not configured.

## Productivity overview and weekly review

**Local-first review implemented November 10, 2026.** The Review screen summarizes Inbox, overdue, next-seven-day deadlines, Waiting tasks, due-soon work without a matching plan date, recent completion counts, and projects with open work. Its cards link to matching task filters; calculations remain on-device and do not call AI. AI-generated weekly suggestions and a date-grouped upcoming schedule remain future work.

The dashboard should help someone decide what needs attention and what is moving; it should not turn task counts into a score.

- **Action queue:** Inbox tasks, overdue open tasks, tasks due today, and Waiting tasks. Each item opens the task and offers a relevant action.
- **Upcoming schedule:** open tasks by due date for today and the next six local dates. Label this “Tasks due by day,” not workload or capacity.
- **Recent completion trend:** completed-task counts for the four most recent complete local calendar weeks, with the current partial week shown separately if useful. Compare only equal, complete weeks.
- **Project overview:** open and Waiting task counts by Area/project; defer percentages until the rules for completed, archived, and cancelled tasks are defined.
- Apply filters consistently to the queue, charts, drill-down task list, and any export. Distinguish no matching data, unavailable history, and a real zero.
- Do not show productivity scores, streaks, or unqualified on-time rates. Task counts describe recorded activity, not effort, value, or time capacity.

Current task records can support due-date queues and completion counts. Project and stage summaries need the corresponding fields first; meaningful capacity views need task duration estimates and should wait.

## Later options

- Task duration estimates and focus sessions can support time budgeting after users have a reliable daily plan.
- Dependencies and milestones can help larger projects after the simpler project workflow is stable.
- Calendar sync and cross-device sync should be separate integrations because they add permissions, conflict handling, and external data movement.

## Recommended sequence

1. Complete the current local task and reviewed-AI foundation. (Implemented.)
2. Add My Day, All Tasks, and explicit separation of planned date and due date. (Implemented.)
3. Add Areas/projects and a List/Board workflow with Next, In progress, and Waiting stages. (Implemented; projects can be assigned to Areas, project tasks retain their due dates and can be planned for My Day.)
4. Add recurring routines, saved filters, and templates. (Recurring tasks and saved task views implemented; reusable checklist templates remain.)
5. Add the local weekly review and compact productivity overview. (Implemented; AI project/Inbox assistance and a date-grouped upcoming schedule remain.)
6. Consider estimates, focus sessions, dependencies, calendar sync, or cloud sync only after real usage shows they are needed.

## Reference patterns

- Todoist organizes work with projects, Today/Upcoming views, priorities, subtasks, and list/board layouts: [Get started with Todoist](https://www.todoist.com/help/todoist/get-started/get-started-with-todoist-OgNNJR), [board layout](https://www.todoist.com/help/todoist/features/use-the-board-layout-in-todoist-AiAVsyEI).
- Microsoft To Do's My Day is a daily selection that resets while unfinished tasks remain in their original plan: [Plan your day with My Day](https://support.microsoft.com/en-us/planner/teams/plan-your-day-with-my-day).
- Todoist recurrence controls distinguish changing the repeat rule from moving one occurrence: [Introduction to recurring dates](https://www.todoist.com/help/todoist/features/introduction-to-recurring-dates-YUYVJJAV).
- Todoist's productivity view reports completed-task counts by day and week: [Productivity view](https://www.todoist.com/help/todoist/features/use-the-productivity-view-in-todoist-6S63uAa9).
- Asana describes workflows as repeatable steps from intake to completion and dashboards for project progress, workload, and blockers: [Workflows](https://help.asana.com/s/article/what-is-a-workflow?language=en_US), [dashboards and portfolios](https://help.asana.com/s/article/monitor-initiatives-and-manage-resources-with-portfolios).
