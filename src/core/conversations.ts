import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import { openSQLiteDatabase } from './sqlite'
import type { ChatImageAttachment, ChatMessage, ChatMode, ChatSession } from '../shared/types'
import type { ProviderMessage } from './providers/types'

interface SessionRow {
  id: string
  title: string
  created_at: string
  updated_at: string
}

interface MessageRow {
  id: string
  role: ChatMessage['role']
  content: string
  at: string
  mode: string | null
}

interface ImageAttachmentRow extends ChatImageAttachment {
  message_id: string
  data?: Uint8Array
}

export interface ConversationSearchMatch {
  sessionId: string
  sessionTitle: string
  role: 'user' | 'assistant'
  at: string
  excerpt: string
}

/** Local durable chat memory. Audit records remain metadata-only. */
export class ConversationStore {
  private db: DatabaseSync
  private closed = false

  constructor(private readonly file: string) {
    this.db = openSQLiteDatabase(file)
  }

  async init(): Promise<void> {
    if (this.closed) {
      this.db = openSQLiteDatabase(this.file)
      this.closed = false
    }
    // DatabaseSync opens the file on construction, so ensure the parent exists
    // before the store is instantiated by the main process.
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        at TEXT NOT NULL,
        mode TEXT
      );
      CREATE INDEX IF NOT EXISTS chat_messages_session_order
        ON chat_messages(session_id, at, id);
      CREATE TABLE IF NOT EXISTS provider_history (
        session_id TEXT PRIMARY KEY REFERENCES chat_sessions(id) ON DELETE CASCADE,
        history_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chat_image_attachments (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        mimeType TEXT NOT NULL CHECK (mimeType IN ('image/png', 'image/jpeg', 'image/webp')),
        size INTEGER NOT NULL CHECK (size > 0),
        data BLOB NOT NULL,
        CHECK (length(data) = size)
      );
      CREATE INDEX IF NOT EXISTS chat_image_attachments_message
        ON chat_image_attachments(message_id);
    `)

    const messageColumns = this.db.prepare('PRAGMA table_info(chat_messages)').all() as Array<{ name: string }>
    if (!messageColumns.some((column) => column.name === 'mode')) {
      this.db.exec('ALTER TABLE chat_messages ADD COLUMN mode TEXT')
    }

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chat_messages_fts
        USING fts5(content, content='chat_messages', content_rowid='rowid');
      CREATE TRIGGER IF NOT EXISTS chat_messages_fts_insert AFTER INSERT ON chat_messages BEGIN
        INSERT INTO chat_messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS chat_messages_fts_delete AFTER DELETE ON chat_messages BEGIN
        INSERT INTO chat_messages_fts(chat_messages_fts, rowid, content)
          VALUES ('delete', old.rowid, old.content);
      END;
      CREATE TRIGGER IF NOT EXISTS chat_messages_fts_update AFTER UPDATE OF content ON chat_messages BEGIN
        INSERT INTO chat_messages_fts(chat_messages_fts, rowid, content)
          VALUES ('delete', old.rowid, old.content);
        INSERT INTO chat_messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
    `)

    const searchVersion = this.db
      .prepare("SELECT value FROM app_meta WHERE key = 'conversation_search_version'")
      .get() as { value?: string } | undefined
    if (searchVersion?.value !== '1') {
      this.db.exec('BEGIN IMMEDIATE')
      try {
        this.db.prepare("INSERT INTO chat_messages_fts(chat_messages_fts) VALUES ('rebuild')").run()
        this.db.prepare(`
          INSERT INTO app_meta (key, value) VALUES ('conversation_search_version', '1')
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run()
        this.db.exec('COMMIT')
      } catch (error) {
        try { this.db.exec('ROLLBACK') } catch { /* Keep the original migration failure. */ }
        throw error
      }
    }

    if (!this.activeSessionId()) {
      this.createSession()
    }
  }

  createSession(): ChatSession {
    const session: ChatSession = {
      id: randomUUID(),
      title: 'New chat',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    this.db.prepare(
      'INSERT INTO chat_sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)'
    ).run(session.id, session.title, session.createdAt, session.updatedAt)
    this.setActiveSession(session.id)
    return session
  }

  listSessions(): ChatSession[] {
    const rows = this.db
      .prepare('SELECT id, title, created_at, updated_at FROM chat_sessions ORDER BY updated_at DESC')
      .all() as unknown as SessionRow[]

    return rows.map(toSession)
  }

  getSession(id: string): ChatSession | null {
    const row = this.db
      .prepare('SELECT id, title, created_at, updated_at FROM chat_sessions WHERE id = ?')
      .get(id) as unknown as SessionRow | undefined
    return row ? toSession(row) : null
  }

  activeSessionId(): string | null {
    const row = this.db
      .prepare("SELECT value FROM app_meta WHERE key = 'active_session_id'")
      .get() as { value?: string } | undefined
    const id = row?.value
    return id && this.getSession(id) ? id : null
  }

  setActiveSession(id: string): void {
    if (!this.getSession(id)) throw new Error('That conversation no longer exists.')
    this.db.prepare(`
      INSERT INTO app_meta (key, value) VALUES ('active_session_id', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(id)
  }

  renameSession(id: string, rawTitle: string): ChatSession {
    const session = this.getSession(id)
    if (!session) throw new Error('That conversation no longer exists.')
    const cleaned = rawTitle.replace(/\s+/g, ' ').trim()
    if (!cleaned) throw new Error('Enter a conversation title.')
    const title = cleaned.length > 80 ? `${cleaned.slice(0, 77)}…` : cleaned
    const updatedAt = new Date().toISOString()
    this.db
      .prepare('UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, updatedAt, id)
    return {
      ...session,
      title,
      updatedAt
    }
  }

  deleteSession(id: string): {
    activeSessionId: string
    sessions: ChatSession[]
    messages: ChatMessage[]
  } {
    if (!this.getSession(id)) throw new Error('That conversation no longer exists.')
    const currentActive = this.activeSessionId()
    this.db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(id)

    let sessions = this.listSessions()
    let nextActiveId: string
    if (sessions.length === 0) {
      const created = this.createSession()
      sessions = this.listSessions()
      nextActiveId = created.id
    } else if (!currentActive || currentActive === id || !this.getSession(currentActive)) {
      nextActiveId = sessions[0].id
      this.setActiveSession(nextActiveId)
    } else {
      nextActiveId = currentActive
    }

    return {
      activeSessionId: nextActiveId,
      sessions,
      messages: this.getMessages(nextActiveId)
    }
  }

  deleteMessage(sessionId: string, messageId: string): ChatMessage[] {
    if (!this.getSession(sessionId)) throw new Error('That conversation no longer exists.')
    this.db
      .prepare('DELETE FROM chat_messages WHERE id = ? AND session_id = ?')
      .run(messageId, sessionId)
    return this.getMessages(sessionId)
  }

  exportSessionMarkdown(sessionId: string): string {
    const session = this.getSession(sessionId)
    if (!session) throw new Error('That conversation no longer exists.')
    const messages = this.getMessages(sessionId)
    const lines: string[] = [
      `# ${session.title}`,
      '',
      `- **Exported:** ${new Date().toISOString()}`,
      `- **Messages:** ${messages.length}`,
      ''
    ]
    for (const msg of messages) {
      const speaker =
        msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Mike Assist' : 'System'
      lines.push(`### ${speaker} (${msg.at})`)
      if (msg.attachments?.length) {
        lines.push(
          `*Attachments:* ${msg.attachments.map((att) => `${att.name} (${att.mimeType})`).join(', ')}`
        )
        lines.push('')
      }
      lines.push(msg.text)
      lines.push('')
    }
    return lines.join('\n')
  }

  getMessages(sessionId: string): ChatMessage[] {
    if (!this.getSession(sessionId)) return []
    const rows = this.db
      .prepare('SELECT id, role, content, at, mode FROM chat_messages WHERE session_id = ? ORDER BY rowid')
      .all(sessionId) as unknown as MessageRow[]

    const messages = rows.map((row) => ({
      id: row.id,
      role: row.role,
      text: row.content,
      at: row.at,
      ...(isChatMode(row.mode) ? { mode: row.mode } : {})
    }))
    if (messages.length === 0) return messages

    const placeholders = messages.map(() => '?').join(', ')
    const attachments = this.db.prepare(`
      SELECT message_id, id, name, mimeType, size
      FROM chat_image_attachments
      WHERE message_id IN (${placeholders})
      ORDER BY rowid
    `).all(...messages.map((message) => message.id)) as unknown as ImageAttachmentRow[]
    const byMessage = new Map<string, ChatImageAttachment[]>()
    for (const attachment of attachments) {
      const items = byMessage.get(attachment.message_id) ?? []
      items.push({
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size
      })
      byMessage.set(attachment.message_id, items)
    }

    return messages.map((message) => {
      const messageAttachments = byMessage.get(message.id)
      return messageAttachments?.length ? { ...message, attachments: messageAttachments } : message
    })
  }

  /**
   * Search a few local chat excerpts. Coaching modes are isolated from each
   * other, and ordinary chats never surface either coaching area. Untagged
   * legacy messages are excluded because their original mode is unknown.
   */
  searchMessages(query: string, mode: ChatMode, limit = 5): ConversationSearchMatch[] {
    const terms = [...new Set(query.slice(0, 500).normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? [])]
      .filter((term) => term.length >= 2)
      .slice(0, 8)
    if (terms.length === 0) return []

    const ftsQuery = terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' AND ')
    const allowedModes: ChatMode[] = mode === 'coach_personal'
      ? ['coach_personal']
      : mode === 'coach_business'
        ? ['coach_business']
        : ['assistant', 'brainstorm', 'software', 'review', 'plan', 'build', 'goal']
    const placeholders = allowedModes.map(() => '?').join(', ')
    const requestedLimit = Number.isFinite(limit) ? Math.floor(limit) : 5
    const safeLimit = Math.min(8, Math.max(1, requestedLimit))
    const activeSessionId = this.activeSessionId() ?? ''
    const rows = this.db.prepare(`
      SELECT m.session_id AS sessionId, s.title AS sessionTitle, m.role, m.at,
        snippet(chat_messages_fts, 0, '⟦', '⟧', ' … ', 20) AS excerpt
      FROM chat_messages_fts
      JOIN chat_messages m ON m.rowid = chat_messages_fts.rowid
      JOIN chat_sessions s ON s.id = m.session_id
      WHERE chat_messages_fts MATCH ?
        AND m.role IN ('user', 'assistant')
        AND m.mode IN (${placeholders})
        AND NOT (m.session_id = ? AND m.id = (
          SELECT current.id FROM chat_messages current
          WHERE current.session_id = ? AND current.role = 'user'
          ORDER BY current.rowid DESC LIMIT 1
        ))
      ORDER BY bm25(chat_messages_fts), m.at DESC
      LIMIT ?
    `).all(ftsQuery, ...allowedModes, activeSessionId, activeSessionId, safeLimit) as unknown as Array<{
      sessionId: string
      sessionTitle: string
      role: 'user' | 'assistant'
      at: string
      excerpt: string
    }>

    return rows.map((row) => ({ ...row, excerpt: row.excerpt.slice(0, 1200) }))
  }

  searchSessions(query: string, mode: ChatMode = 'assistant'): ChatSession[] {
    const trimmed = query.trim()
    if (!trimmed) return this.listSessions()
    const lower = trimmed.toLocaleLowerCase()
    const all = this.listSessions()
    const matchedIds = new Set<string>()
    const allowedModes: ChatMode[] = mode === 'coach_personal'
      ? ['coach_personal']
      : mode === 'coach_business'
        ? ['coach_business']
        : ['assistant', 'brainstorm', 'software', 'review', 'plan', 'build', 'goal']
    const modePlaceholders = allowedModes.map(() => '?').join(', ')
    const titleSearchableIds = new Set((this.db.prepare(`
      SELECT s.id FROM chat_sessions s
      WHERE NOT EXISTS (
        SELECT 1 FROM chat_messages existing
        WHERE existing.session_id = s.id AND existing.role IN ('user', 'assistant')
      ) OR EXISTS (
        SELECT 1 FROM chat_messages visible_message
        WHERE visible_message.session_id = s.id AND visible_message.role IN ('user', 'assistant')
          AND (visible_message.mode IN (${modePlaceholders}) OR visible_message.mode IS NULL)
      )
    `).all(...allowedModes) as Array<{ id: string }>).map((row) => row.id))
    for (const session of all) {
      if (titleSearchableIds.has(session.id) && session.title.toLocaleLowerCase().includes(lower)) {
        matchedIds.add(session.id)
      }
    }
    const terms = [...new Set(trimmed.slice(0, 500).normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? [])]
      .filter((term) => term.length >= 2)
      .slice(0, 8)
    if (terms.length > 0) {
      const ftsQuery = terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' AND ')
      const ftsRows = this.db
        .prepare(
          `SELECT DISTINCT m.session_id AS sessionId
           FROM chat_messages_fts
           JOIN chat_messages m ON m.rowid = chat_messages_fts.rowid
           WHERE chat_messages_fts MATCH ?
             AND m.role IN ('user', 'assistant')
             AND (m.mode IN (${modePlaceholders}) OR m.mode IS NULL)
           LIMIT 50`
        )
        .all(ftsQuery, ...allowedModes) as unknown as Array<{ sessionId: string }>
      for (const row of ftsRows) {
        matchedIds.add(row.sessionId)
      }
    }
    return all.filter((session) => matchedIds.has(session.id))
  }

  appendMessage(sessionId: string, message: ChatMessage): void {
    this.appendMessageInternal(sessionId, message, [])
  }

  appendMessageWithAttachments(
    sessionId: string,
    message: ChatMessage,
    attachments: Array<ChatImageAttachment & { data: Uint8Array }>
  ): void {
    if (message.role !== 'user' || attachments.length === 0) {
      throw new Error('Image attachments can only be stored with a user message.')
    }
    const metadata = message.attachments ?? []
    if (metadata.length !== attachments.length ||
      metadata.some((item, index) => item.id !== attachments[index].id)) {
      throw new Error('Image attachment metadata does not match its local data.')
    }
    this.appendMessageInternal(sessionId, message, attachments)
  }

  private appendMessageInternal(
    sessionId: string,
    message: ChatMessage,
    attachments: Array<ChatImageAttachment & { data: Uint8Array }>
  ): void {
    const session = this.getSession(sessionId)
    if (!session) throw new Error('That conversation no longer exists.')

    const updatedAt = new Date().toISOString()
    const title =
      session.title === 'New chat' && message.role === 'user'
        ? compactTitle(message.text)
        : session.title

    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare(`
        INSERT INTO chat_messages (id, session_id, role, content, at, mode)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(message.id, sessionId, message.role, message.text, message.at, message.mode ?? null)
      const insertAttachment = this.db.prepare(`
        INSERT INTO chat_image_attachments (id, message_id, name, mimeType, size, data)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      for (const attachment of attachments) {
        insertAttachment.run(
          attachment.id,
          message.id,
          attachment.name,
          attachment.mimeType,
          attachment.size,
          Buffer.from(attachment.data)
        )
      }
      this.db.prepare('UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?')
        .run(title, updatedAt, sessionId)
      this.db.exec('COMMIT')
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* Keep the original write failure. */ }
      throw error
    }
  }

  getImageAttachments(ids: string[]): Array<ChatImageAttachment & { data: Uint8Array }> {
    const safeIds = [...new Set(ids.filter((id) => typeof id === 'string' && id.length <= 64))].slice(0, 64)
    if (safeIds.length === 0) return []
    const placeholders = safeIds.map(() => '?').join(', ')
    const rows = this.db.prepare(`
      SELECT id, name, mimeType, size, data
      FROM chat_image_attachments
      WHERE id IN (${placeholders})
    `).all(...safeIds) as unknown as ImageAttachmentRow[]
    const byId = new Map(rows.map((row) => [row.id, row]))
    const images: Array<ChatImageAttachment & { data: Uint8Array }> = []
    for (const id of safeIds) {
      const row = byId.get(id)
      if (!row) continue
      images.push({
        id: row.id,
        name: row.name,
        mimeType: row.mimeType,
        size: row.size,
        data: new Uint8Array(row.data ?? [])
      })
    }
    return images
  }

  getProviderHistory(sessionId: string): ProviderMessage[] {
    const row = this.db
      .prepare('SELECT history_json FROM provider_history WHERE session_id = ?')
      .get(sessionId) as { history_json?: string } | undefined

    if (!row?.history_json) return []
    try {
      const history = JSON.parse(row.history_json) as ProviderMessage[]
      return Array.isArray(history) ? history.map(withoutEphemeralImages) : []
    } catch {
      return []
    }
  }

  saveProviderHistory(sessionId: string, history: ProviderMessage[]): void {
    if (!this.getSession(sessionId)) throw new Error('That conversation no longer exists.')
    this.db.prepare(`
      INSERT INTO provider_history (session_id, history_json) VALUES (?, ?)
      ON CONFLICT(session_id) DO UPDATE SET history_json = excluded.history_json
    `).run(sessionId, JSON.stringify(history.map(withoutEphemeralImages)))
  }

  async backupTo(file: string): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true })
    await backup(this.db, file)
  }

  close(): void {
    if (!this.closed) {
      this.db.close()
      this.closed = true
    }
  }
}

function withoutEphemeralImages(message: ProviderMessage): ProviderMessage {
  const copy = { ...message }
  delete copy.images
  return copy
}

export async function createConversationStore(userDataDir: string): Promise<ConversationStore> {
  await mkdir(userDataDir, { recursive: true })
  const store = new ConversationStore(path.join(userDataDir, 'conversations.sqlite'))
  await store.init()
  return store
}

function toSession(row: SessionRow): ChatSession {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function compactTitle(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > 64 ? `${collapsed.slice(0, 61)}…` : collapsed || 'New chat'
}

function isChatMode(value: string | null): value is ChatMode {
  return value === 'assistant' || value === 'brainstorm' || value === 'software' ||
    value === 'review' || value === 'plan' || value === 'build' || value === 'goal' ||
    value === 'coach_personal' || value === 'coach_business'
}
