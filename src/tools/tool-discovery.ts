import { z } from 'zod'
import type { ToolDef } from '../shared/types'
import type { ToolRegistry } from '../core/registry'
import { normalizeSearchText } from '../shared/search-normalization'

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'can', 'do', 'for', 'from', 'i', 'in', 'is', 'it',
  'me', 'my', 'of', 'on', 'or', 'please', 'the', 'to', 'with',
  'bu', 'bir', 've', 'de', 'da', 'icin', 'lutfen', 'benim', 'bana', 'mi', 'mu', 'ne', 'ben'
])

/** Search optional capabilities without sending every integration schema on every turn. */
export function createToolDiscoveryTool(registry: ToolRegistry): ToolDef<{ query: string; limit?: number }, unknown> {
  return {
    name: 'find_tools',
    description:
      'Search additional Mike Assist capabilities when the requested tool is not in the current tool list. Useful for Gmail/email, Google Calendar, Drive and Tasks, finance, saved memory, coaching and Today planning, scheduled tasks, the Knowledge Vault, and connected MCP integrations. Returns matching tool names and descriptions; their schemas become available on the next step.',
    risk: 'read',
    input: z.object({ query: z.string().trim().min(2).max(160), limit: z.number().int().min(1).max(4).optional() }),
    scope: () => ({ kind: 'none' }),
    run: async ({ query, limit }) => {
      const queryTokens = tokenize(query)
      const matches = registry.list()
        .filter((tool) => tool.name !== 'find_tools')
        .map((tool, index) => ({
          name: tool.name,
          description: tool.description,
          index,
          score: scoreTool(query, queryTokens, tool.name, tool.description)
        }))
        .filter((tool) => tool.score > 0)
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .slice(0, limit ?? 4)
        .map(({ name, description }) => ({ name, description }))

      return { query, tools: matches }
    }
  }
}

function scoreTool(query: string, queryTokens: string[], name: string, description: string): number {
  const lowerName = normalizeSearchText(name)
  const lowerDescription = normalizeSearchText(description)
  const lowerQuery = normalizeSearchText(query)
  let score = lowerName.includes(lowerQuery) || lowerDescription.includes(lowerQuery) ? 8 : 0
  const nameTokens = new Set(tokenize(name.replace(/__/g, ' ')))
  const descriptionTokens = new Set(tokenize(description))
  const aliasTokens = new Set(tokenize(aliasesForTool(name)))
  for (const token of queryTokens) {
    if (nameTokens.has(token)) score += 5
    else if (lowerName.includes(token)) score += 3
    if (descriptionTokens.has(token)) score += 2
    else if (lowerDescription.includes(token)) score += 1
    if (aliasTokens.has(token)) score += 4
    else if (token.length >= 4 && [...aliasTokens].some((alias) => token.startsWith(alias) || alias.startsWith(token))) score += 3
  }
  return score
}

function tokenize(text: string): string[] {
  return [...new Set(normalizeSearchText(text).match(/[a-z0-9]+/g) ?? [])]
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
}

function aliasesForTool(name: string): string {
  if (name.startsWith('gmail_') || name.startsWith('microsoft_mail_') || name === 'create_email_draft' || name === 'create_email_followup_task') {
    return 'eposta mail gelen kutusu taslak gonder yanit alici task followup follow-up task from email email follow-up make a task'
  }
  if (name.startsWith('google_calendar_') || name.startsWith('microsoft_calendar_') || name === 'create_calendar_event' || name === 'create_calendar_prep_task') {
    return 'outlook calendar event meeting appointment agenda availability prepare prep task follow-up takvim etkinlik toplanti randevu musaitlik ajanda hazirlik gorev'
  }
  if (name.startsWith('google_drive_')) {
    return 'drive dokuman belge dosya klasor sunum tablo rapor teklif sozlesme'
  }
  if (name.startsWith('google_tasks_')) {
    return 'google tasks send export copy push sync gorev task list yapilacak bugun yarin plan oncelik'
  }
  if (name.startsWith('microsoft_todo_')) {
    return 'microsoft todo tasks send export copy push sync gorev task list yapilacak bugun yarin plan oncelik'
  }
  if (name.startsWith('finance_') || name === 'record_transaction') {
    return 'finans para harcama masraf gider gelir butce maliyet kazanc ciro fatura odeme'
  }
  if (name.includes('memory')) return 'bellek hafiza hatirla unutma tercih kaydet'
  if (name.includes('coaching') || name === 'get_coaching_context') {
    return 'koc kocluk kisisel isletme hedef gunluk yansima aliskanlik motivasyon'
  }
  if (name === 'list_today' || name === 'create_task' || name === 'create_email_followup_task' || name === 'capture_inbox' ||
      name === 'update_task' || name === 'complete_task' || name === 'clear_task_export_retry_guard' || name.startsWith('schedule_agent_task') ||
      name === 'list_scheduled_agent_tasks') {
    return 'bugun yarin gorev yapilacak hatirlatma oncelik plan otomasyon zamanlama'
  }
  if (name.includes('vault')) return 'bilgi kasasi arastirma kaynak bilgi calisma referans ders notu'
  if (name.startsWith('browser_')) return 'tarayici web internet site sayfa ac tikla incele doldur'
  return ''
}
