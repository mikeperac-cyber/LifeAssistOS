import type { View } from '../navigation'

const WORK_AREAS: Array<{
  view: View
  eyebrow: string
  title: string
  description: string
  glyph: string
}> = [
  { view: 'today', eyebrow: 'Plan', title: 'Tasks', description: 'Set priorities, due dates, and reminders. Send a task to a connected list when you approve it.', glyph: '◷' },
  { view: 'email', eyebrow: 'Communicate', title: 'Email', description: 'Search approved Gmail or Outlook messages and turn a conversation into a follow-up.', glyph: '✉' },
  { view: 'cloud_files', eyebrow: 'Find context', title: 'Cloud files', description: 'Search connected Drive or OneDrive files and choose what Mike Assist may read.', glyph: '▤' },
  { view: 'research', eyebrow: 'Explore', title: 'Research', description: 'Build a focused brief from approved web sources and keep the useful findings.', glyph: '⌕' },
  { view: 'teaching', eyebrow: 'Create', title: 'Teaching packs', description: 'Start an IELTS or English lesson from a reusable teaching frame.', glyph: '✦' },
  { view: 'workflows', eyebrow: 'Repeat', title: 'Workflows', description: 'Replay a saved sequence through the same permission checks as a manual run.', glyph: '↻' },
  { view: 'scheduled', eyebrow: 'Stay on track', title: 'Scheduled work', description: 'Set recurring check-ins and runs, with action approvals at run time.', glyph: '◴' }
]

export function WorkView({ onNavigate }: { onNavigate: (view: View) => void }): React.JSX.Element {
  return (
    <div className="work-view">
      <section className="work-hero">
        <div>
          <span className="eyebrow">Your workspace</span>
          <h2>Move work forward</h2>
          <p>Plan the next step, bring in the right context, then turn repeatable work into a workflow.</p>
        </div>
        <div className="work-hero-actions">
          <button className="primary-button" type="button" onClick={() => onNavigate('today')}>Plan a task</button>
          <button className="ghost-button" type="button" onClick={() => onNavigate('workflows')}>Open workflows</button>
        </div>
        <div className="work-hero-mark" aria-hidden="true">W</div>
      </section>

      <div className="work-grid" aria-label="Work areas">
        {WORK_AREAS.map((area) => (
          <button className="work-card" type="button" key={area.view} onClick={() => onNavigate(area.view)}>
            <span className="work-card-top">
              <span className="work-card-glyph" aria-hidden="true">{area.glyph}</span>
              <span className="work-card-eyebrow">{area.eyebrow}</span>
              <span className="work-card-arrow" aria-hidden="true">↗</span>
            </span>
            <strong>{area.title}</strong>
            <span className="work-card-description">{area.description}</span>
          </button>
        ))}
      </div>
      <p className="work-privacy-note">Connected accounts stay separate. Each external read or write follows its own approval step.</p>
    </div>
  )
}
