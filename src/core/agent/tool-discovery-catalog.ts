import type { AssistantSkillSummary, ChatMode } from '../../shared/types'
import { normalizeSearchText } from '../../shared/search-normalization'
import type { ProviderToolSpec } from '../providers/types'

export function skillsForMode(skills: AssistantSkillSummary[], mode: ChatMode): AssistantSkillSummary[] {
  if (mode === 'coach_personal') return skills.filter((skill) => skill.scope === 'general' || skill.scope === 'personal')
  if (mode === 'coach_business') return skills.filter((skill) => skill.scope === 'general' || skill.scope === 'business' || skill.scope === 'education')
  if (mode === 'software' || mode === 'review') return skills.filter((skill) => skill.scope === 'general' || skill.scope === 'coding')
  return skills
}

export type OptionalToolDomain = 'email' | 'calendar' | 'drive' | 'finance' | 'memory' | 'coaching' | 'planning' | 'vault' | 'mcp'

const DOMAIN_SIGNALS: Record<Exclude<OptionalToolDomain, 'mcp'>, RegExp> = {
  email: /\b(email|mail|gmail|inbox|draft|send|reply|recipient|message|eposta|posta|taslak|gonder|yanit|alici|mesaj|gelen\s+kutusu)\w*\b/i,
  calendar: /\b(calendar|event|meeting|appointment|invite|availability|schedule|takvim|etkinlik|toplanti|randevu|musaitlik|ajanda|program)\w*\b/i,
  drive: /\b(drive|google\s+(drive|docs|sheets|slides)|document|docs|spreadsheet|sheets|slides|file|folder|proposal|contract|report|dokuman|belge|dosya|klasor|teklif|sozlesme|sunum|tablo|rapor)\w*\b/i,
  finance: /\b(finance|financial|money|expense|spend|income|budget|transaction|cost|profit|revenue|ledger|finans|para|harcama|masraf|gider|gelir|butce|maliyet|kazanc|ciro|fatura|odeme)\w*\b/i,
  memory: /\b(memory|remember|recall|forget|preference|saved\s+fact|bellek|hafiza|hatirla|unutma|tercih|kaydedilen|animsat)\w*\b/i,
  coaching: /\b(coach|goal|journal|reflection|habit|personal|business|lb\s+english|ielts|teaching|koc|kocluk|hedef|gunluk|yansima|aliskanlik|kisisel|yasam|motivasyon|isletme|is\s+plani|egitim|ogretim|ogretmen|ders)\w*\b/i,
  planning: /\b(today|task|remind|deadline|to-do|todo|schedule|priority|plan|bugun|yarin|gorev|hatirlat|oncelik|yapilacak|son\s+tarih|yapmam\s+gereken)\w*\b/i,
  vault: /\b(vault|research|source|knowledge|study|reference|bilgi\s+kasasi|arastirma|kaynak|bilgi|calisma|referans|ders\s+notu)\w*\b/i
}

export function selectToolSpecsForTurn(tools: ProviderToolSpec[], prompt: string, mode: ChatMode): ProviderToolSpec[] {
  const normalizedPrompt = normalizeSearchText(prompt)
  const promptTokens = new Set(normalizedPrompt.match(/[a-z0-9]+/g) ?? [])
  return tools.filter((tool) => {
    const name = tool.function.name
    if (name === 'find_tools') return true
    const domain = optionalToolDomain(name)
    if (!domain) return true
    if ((mode === 'coach_personal' || mode === 'coach_business') &&
      (domain === 'coaching' || domain === 'planning')) return true
    if (domain === 'mcp') {
      if (/\b(mcp|integration|connector|connected app|entegrasyon|baglanti|bagli uygulama)\b/i.test(normalizedPrompt)) return true
      const toolTokens = new Set(normalizeSearchText(`${name} ${tool.function.description}`).match(/[a-z0-9]+/g) ?? [])
      return [...promptTokens].some((token) => token.length > 2 && toolTokens.has(token))
    }
    return DOMAIN_SIGNALS[domain].test(prompt)
  })
}

export function optionalToolDomain(name: string): OptionalToolDomain | null {
  if (name.startsWith('mcp__')) return 'mcp'
  if (name.startsWith('gmail_') || name === 'create_email_draft') return 'email'
  if (name.startsWith('google_calendar_') || name.startsWith('microsoft_calendar_') || name === 'create_calendar_event') return 'calendar'
  if (name.startsWith('google_drive_')) return 'drive'
  if (name.startsWith('google_tasks_')) return 'planning'
  if (name.startsWith('finance_') || name === 'record_transaction') return 'finance'
  if (name.includes('memory') || name === 'recall_memory') return 'memory'
  if (name.includes('coaching') || name === 'get_coaching_context') return 'coaching'
  if (name.includes('vault')) return 'vault'
  if (name === 'list_today' || name === 'capture_inbox' || name === 'create_task' || name === 'update_task' ||
    name === 'complete_task' || name === 'schedule_agent_task' || name === 'list_scheduled_agent_tasks') {
    return 'planning'
  }
  return null
}
