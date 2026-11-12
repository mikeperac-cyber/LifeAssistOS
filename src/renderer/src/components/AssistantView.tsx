import { useCallback, useEffect, useState } from 'react'
import type { PublicSettings } from '../../../shared/ipc'
import { AssistantPanel } from './AssistantPanel'
import { isProviderReady } from './provider-readiness'

export function AssistantView({ visible, settings, refreshVersion, initialPrompt, onInitialPromptConsumed, onOpenSettings }: {
  visible: boolean
  settings: PublicSettings | null
  refreshVersion: number
  initialPrompt: string
  onInitialPromptConsumed: () => void
  onOpenSettings: () => void
}): React.JSX.Element {
  const [lifeContextAvailable, setLifeContextAvailable] = useState({ goals: false, journal: false, personalContext: false })
  const [error, setError] = useState('')

  const refreshTasks = useCallback(async (): Promise<void> => {
    setError('')
    try {
      const [workspace, journal, profile] = await Promise.all([
        window.assist.getLifeWorkspace(), window.assist.getJournalEntries(), window.assist.getPersonalContext()
      ])
      setLifeContextAvailable({ goals: workspace.goals.some((goal) => goal.status !== 'done'), journal: journal.some((entry) => Boolean(entry.content.trim())), personalContext: Boolean(profile.aboutMe.trim() || profile.preferences.trim() || profile.currentFocus.trim()) })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your tasks could not be loaded.')
    }
  }, [])

  useEffect(() => {
    if (visible) void refreshTasks()
  }, [refreshTasks, refreshVersion, visible])
  useEffect(() => {
    if (!visible) return
    const onFocus = (): void => { void refreshTasks() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshTasks, visible])

  return (
    <section className="assistant-page" aria-label="Coach, teacher, and assistant" hidden={!visible}>
      <header className="assistant-page-heading">
        <h2>What would you like help with?</h2>
        <p>Talk through a choice, learn something step by step, or organize your next move.</p>
      </header>
      {error && <p className="assistant-page-error" role="status">Task context could not be loaded. You can still chat without sharing tasks. <button type="button" onClick={() => void refreshTasks()}>Retry</button></p>}
      <AssistantPanel providerReady={isProviderReady(settings)} lifeContextAvailable={lifeContextAvailable} initialPrompt={initialPrompt} onInitialPromptConsumed={onInitialPromptConsumed} onOpenSettings={onOpenSettings} compactHeader />
    </section>
  )
}
