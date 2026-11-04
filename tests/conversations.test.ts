import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConversationStore } from '../src/core/conversations'
import type { ProviderMessage } from '../src/core/providers/types'
import type { ChatMessage } from '../src/shared/types'

let dir = ''
let file = ''
let store: ConversationStore

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-conversations-'))
  file = path.join(dir, 'conversations.sqlite')
  store = new ConversationStore(file)
  await store.init()
})

afterEach(async () => {
  store.close()
  await rm(dir, { recursive: true, force: true })
})

describe('ConversationStore', () => {
  it('creates a durable default active session', () => {
    const id = store.activeSessionId()
    expect(id).toBeTruthy()
    expect(store.listSessions()).toHaveLength(1)
    expect(store.getSession(id!)?.title).toBe('New chat')
  })

  it('persists messages and titles a session from its first user message', () => {
    const id = store.activeSessionId()!
    store.appendMessage(id, {
      id: 'user-1',
      role: 'user',
      text: 'Summarize my course notes',
      at: '2026-11-02T12:00:00.000Z'
    })
    store.appendMessage(id, {
      id: 'assistant-1',
      role: 'assistant',
      text: 'Here is the summary.',
      at: '2026-11-02T12:00:01.000Z'
    })

    expect(store.getSession(id)?.title).toBe('Summarize my course notes')
    expect(store.getMessages(id).map((message) => message.text)).toEqual([
      'Summarize my course notes',
      'Here is the summary.'
    ])
  })

  it('persists image bytes locally and restores attachment metadata with chat history', async () => {
    const sessionId = store.activeSessionId()!
    const imageBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47])
    const imageBytes2 = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])
    const attachment = {
      id: 'image-1',
      name: 'whiteboard.png',
      mimeType: 'image/png' as const,
      size: imageBytes.length,
      data: imageBytes
    }
    const attachment2 = {
      id: 'a-image',
      name: 'note.jpg',
      mimeType: 'image/jpeg' as const,
      size: imageBytes2.length,
      data: imageBytes2
    }
    store.appendMessageWithAttachments(sessionId, {
      id: 'user-image',
      role: 'user',
      text: 'Read this whiteboard',
      at: '2026-11-03T09:00:00.000Z',
      attachments: [{
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size
      }, {
        id: attachment2.id,
        name: attachment2.name,
        mimeType: attachment2.mimeType,
        size: attachment2.size
      }]
    }, [attachment, attachment2])

    expect(store.getMessages(sessionId)[0].attachments).toEqual([{
      id: attachment.id,
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size
    }, {
      id: attachment2.id,
      name: attachment2.name,
      mimeType: attachment2.mimeType,
      size: attachment2.size
    }])
    expect(store.getImageAttachments([attachment.id, attachment2.id]).map((entry) => entry.id))
      .toEqual([attachment.id, attachment2.id])
    expect(store.getImageAttachments([attachment.id])[0]).toMatchObject(attachment)
    expect(store.getImageAttachments([attachment.id])[0].data).toEqual(imageBytes)

    const backupFile = path.join(dir, 'backup', 'conversations.sqlite')
    await store.backupTo(backupFile)
    const backupStore = new ConversationStore(backupFile)
    try {
      await backupStore.init()
      expect(backupStore.getImageAttachments([attachment.id])[0].data).toEqual(imageBytes)
      expect(backupStore.getMessages(sessionId)[0].attachments).toHaveLength(2)
    } finally {
      backupStore.close()
    }
  })

  it('preserves the original SQLite error when a failed message write already rolled back', () => {
    const sessionId = store.activeSessionId()!
    const fault = new DatabaseSync(file)
    fault.exec(`
      CREATE TRIGGER fail_message_insert BEFORE INSERT ON chat_messages BEGIN
        SELECT RAISE(ROLLBACK, 'forced message insert failure');
      END;
    `)
    try {
      expect(() => store.appendMessage(sessionId, {
        id: 'failed-message',
        role: 'user',
        text: 'This write must roll back.',
        at: new Date().toISOString()
      })).toThrow(/forced message insert failure/)
    } finally {
      fault.exec('DROP TRIGGER fail_message_insert')
      fault.close()
    }

    expect(store.getMessages(sessionId)).toEqual([])
    expect(store.getSession(sessionId)?.title).toBe('New chat')
  })

  it('keeps provider tool history and active session across restarts', () => {
    const firstId = store.activeSessionId()!
    const second = store.createSession()
    const history: ProviderMessage[] = [
      { role: 'user', content: 'Read the file' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'tool-1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"a.txt"}' }
          }
        ]
      },
      { role: 'tool', tool_call_id: 'tool-1', content: '{"content":"private local content"}' }
    ]
    store.saveProviderHistory(second.id, history)
    store.close()

    store = new ConversationStore(file)
    void store.init()

    expect(store.activeSessionId()).toBe(second.id)
    expect(store.getSession(firstId)).toBeTruthy()
    expect(store.getProviderHistory(second.id)).toEqual(history)
  })

  it('keeps the stored conversation scoped to its session', () => {
    const first = store.activeSessionId()!
    const second = store.createSession()
    store.appendMessage(second.id, {
      id: 'only-here',
      role: 'user',
      text: 'second chat',
      at: new Date().toISOString()
    })

    expect(store.getMessages(first)).toEqual([])
    expect(store.getMessages(second.id)).toHaveLength(1)
    expect(store.listSessions()).toHaveLength(2)
  })

  it('searches chat excerpts without crossing personal, business, or untagged history', () => {
    const writeMessage = (id: string, text: string, mode?: ChatMessage['mode']): void => {
      const session = store.createSession()
      store.appendMessage(session.id, {
        id,
        role: 'user',
        text,
        at: new Date().toISOString(),
        ...(mode ? { mode } : {})
      })
    }
    writeMessage('personal-chat', 'IELTS lesson reflection for personal progress.', 'coach_personal')
    writeMessage('business-chat', 'IELTS lesson plan for business growth.', 'coach_business')
    writeMessage('general-chat', 'IELTS lesson design from our general discussion.', 'assistant')
    writeMessage('legacy-chat', 'IELTS lesson from an older chat with unknown mode.')

    expect(store.searchMessages('IELTS lesson', 'coach_personal').map((match) => match.sessionTitle))
      .toEqual(['IELTS lesson reflection for personal progress.'])
    expect(store.searchMessages('IELTS lesson', 'coach_business').map((match) => match.sessionTitle))
      .toEqual(['IELTS lesson plan for business growth.'])
    expect(store.searchMessages('IELTS lesson', 'assistant').map((match) => match.sessionTitle))
      .toEqual(['IELTS lesson design from our general discussion.'])
  })

  it('migrates an older chat database and indexes new mode-tagged messages', async () => {
    const legacyFile = path.join(dir, 'legacy.sqlite')
    const legacyDb = new DatabaseSync(legacyFile)
    legacyDb.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE chat_sessions (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE chat_messages (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')), content TEXT NOT NULL, at TEXT NOT NULL
      );
      CREATE TABLE provider_history (
        session_id TEXT PRIMARY KEY REFERENCES chat_sessions(id) ON DELETE CASCADE, history_json TEXT NOT NULL
      );
    `)
    legacyDb.prepare('INSERT INTO chat_sessions VALUES (?, ?, ?, ?)')
      .run('legacy-session', 'Legacy chat', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')
    legacyDb.prepare('INSERT INTO chat_messages VALUES (?, ?, ?, ?, ?)')
      .run('legacy-message', 'legacy-session', 'user', 'Old lesson goal remains available in its chat.', '2025-01-01T00:00:00.000Z')
    legacyDb.close()

    const migrated = new ConversationStore(legacyFile)
    await migrated.init()
    try {
      expect(migrated.getMessages('legacy-session')[0].text).toContain('Old lesson goal')
      expect(migrated.searchMessages('lesson goal', 'assistant')).toEqual([])
      migrated.appendMessage('legacy-session', {
        id: 'tagged-message', role: 'user', text: 'New lesson goal belongs to this chat.',
        at: new Date().toISOString(), mode: 'assistant'
      })
      expect(migrated.searchMessages('lesson goal', 'assistant')).toHaveLength(1)
    } finally {
      migrated.close()
    }
  })

  it('creates a consistent SQLite backup that can be reopened', async () => {
    const id = store.activeSessionId()!
    store.appendMessage(id, {
      id: 'backup-message',
      role: 'user',
      text: 'Keep this in the backup',
      at: new Date().toISOString()
    })
    const backupFile = path.join(dir, 'backup', 'conversations.sqlite')
    await store.backupTo(backupFile)

    const backupStore = new ConversationStore(backupFile)
    await backupStore.init()
    expect(backupStore.getMessages(id).map((message) => message.text)).toEqual([
      'Keep this in the backup'
    ])
    backupStore.close()
  })

  it('renames a session and rejects blank titles', () => {
    const id = store.activeSessionId()!
    const renamed = store.renameSession(id, '  IELTS Speaking Module  ')
    expect(renamed.title).toBe('IELTS Speaking Module')
    expect(store.getSession(id)?.title).toBe('IELTS Speaking Module')
    expect(() => store.renameSession(id, '   ')).toThrow(/title/i)
  })

  it('deletes a session, cascades messages/attachments/FTS, and ensures an active session remains', () => {
    const firstId = store.activeSessionId()!
    store.appendMessage(firstId, {
      id: 'msg-1',
      role: 'user',
      text: 'UniqueKeywordAlpha in first session',
      at: '2026-11-03T10:00:00.000Z',
      mode: 'assistant'
    })
    const second = store.createSession()
    store.appendMessage(second.id, {
      id: 'msg-2',
      role: 'user',
      text: 'Second session content',
      at: '2026-11-03T10:05:00.000Z',
      mode: 'assistant'
    })

    // Delete first session while second is active
    const afterFirstDelete = store.deleteSession(firstId)
    expect(afterFirstDelete.activeSessionId).toBe(second.id)
    expect(afterFirstDelete.sessions.map((s) => s.id)).toEqual([second.id])
    expect(store.getSession(firstId)).toBeNull()
    expect(store.searchMessages('UniqueKeywordAlpha', 'assistant')).toEqual([])

    // Delete the last remaining session — a fresh default session is created automatically
    const afterLastDelete = store.deleteSession(second.id)
    expect(afterLastDelete.sessions).toHaveLength(1)
    expect(afterLastDelete.activeSessionId).toBe(afterLastDelete.sessions[0].id)
    expect(afterLastDelete.activeSessionId).not.toBe(second.id)
    expect(afterLastDelete.messages).toEqual([])
  })

  it('deletes an individual message and its attachments from a session', () => {
    const id = store.activeSessionId()!
    store.appendMessage(id, {
      id: 'm-keep',
      role: 'user',
      text: 'Keep this message',
      at: '2026-11-03T11:00:00.000Z'
    })
    store.appendMessage(id, {
      id: 'm-remove',
      role: 'assistant',
      text: 'Remove this message',
      at: '2026-11-03T11:01:00.000Z'
    })

    const remaining = store.deleteMessage(id, 'm-remove')
    expect(remaining.map((m) => m.id)).toEqual(['m-keep'])
    expect(store.getMessages(id).map((m) => m.id)).toEqual(['m-keep'])
  })

  it('exports a session as formatted Markdown', () => {
    const id = store.activeSessionId()!
    store.renameSession(id, 'Weekly Review')
    store.appendMessage(id, {
      id: 'u1',
      role: 'user',
      text: 'What are my top priorities?',
      at: '2026-11-03T12:00:00.000Z'
    })
    store.appendMessage(id, {
      id: 'a1',
      role: 'assistant',
      text: '1. Finish the IELTS rubric.\n2. Review finances.',
      at: '2026-11-03T12:00:05.000Z'
    })

    const markdown = store.exportSessionMarkdown(id)
    expect(markdown).toContain('# Weekly Review')
    expect(markdown).toContain('What are my top priorities?')
    expect(markdown).toContain('1. Finish the IELTS rubric.')
  })

  it('searches sessions by title or message content for UI filtering', () => {
    const id = store.activeSessionId()!
    store.renameSession(id, 'Denizli Budget Planning')
    store.appendMessage(id, {
      id: 'u-budget',
      role: 'user',
      text: 'Track monthly rent and utilities',
      at: '2026-11-03T12:10:00.000Z',
      mode: 'assistant'
    })

    expect(store.searchSessions('Denizli', 'assistant').map((s) => s.id)).toContain(id)
    expect(store.searchSessions('utilities', 'assistant').map((s) => s.id)).toContain(id)
  })
})
