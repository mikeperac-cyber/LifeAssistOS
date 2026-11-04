import type { PlanningStore, PendingTaskReminder } from './planning'

export type ReminderDelivery = (reminder: PendingTaskReminder) => void | Promise<void>

/** Polls durable task reminders while the app is running and delivers each once. */
export class TaskReminderScheduler {
  private timer: ReturnType<typeof setInterval> | undefined
  private checking = false

  constructor(
    private readonly planning: PlanningStore,
    private readonly deliver: ReminderDelivery,
    private readonly intervalMs = 15_000,
    private readonly now: () => Date = () => new Date()
  ) {}

  start(): void {
    if (this.timer) return
    void this.checkDue()
    this.timer = setInterval(() => { void this.checkDue() }, Math.max(500, this.intervalMs))
    this.timer.unref?.()
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = undefined
  }

  async checkDue(): Promise<void> {
    if (this.checking) return
    this.checking = true
    try {
      const checkedAt = this.now().toISOString()
      const due = this.planning.listDueReminders(checkedAt)
      for (const reminder of due) {
        try {
          await this.deliver(reminder)
          this.planning.markReminderNotified(reminder.id, reminder.remindAt, checkedAt)
        } catch (error) {
          console.error('[reminders] notification delivery failed', error)
        }
      }
    } finally {
      this.checking = false
    }
  }
}
