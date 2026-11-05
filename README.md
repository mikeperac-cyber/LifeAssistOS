# Mike Assist

Mike Assist is a local-first desktop AI assistant. The model proposes actions; a deterministic permission gateway decides whether each tool call is allowed, blocked, or sent to you for one-time approval. Audit records contain metadata, not chat or file contents.

## Features

- Electron + React desktop app with a sandboxed renderer and typed IPC.
- OpenAI Chat Completions-compatible provider for Ollama, LM Studio, OpenAI, and compatible servers.
- Optional OpenAI-compatible local API server for other clients, bound to IPv4 loopback with a session-only bearer token. Requests run through the same agent, task lock, and approval gateway and are not saved to chat history.
- Streaming, sequential tool execution, configurable step limits, context trimming, and cancellation.
- Bounded dependent tool sequences of up to eight registered calls for fixed workflows, plus an approval-gated JavaScript runner for real loops and branching across tool results.
- Task-aware tool loading keeps common capabilities ready and searches specialized local, coaching, business, and connected-app tools on demand.
- English and Turkish intent matching helps surface optional tools from natural-language requests in either language, including Turkish finance and integration searches; replies follow the language of the user's request unless asked otherwise.
- An in-memory sequential task queue so you can prepare several prompts without overlapping approval dialogs.
- Approval-gated delegation for focused helper tasks, including one-approved-call batches of up to four independent subtasks that run concurrently. Each helper runs in an isolated session with read-only tools; it receives no transcript, saved memory, coaching context, finance, Today tasks, calendar data, email, or skills and cannot change files, run commands, use MCP/browser actions, or delegate again. Batch helpers can fetch allowlisted URLs; interactive web search stays in the main chat or a single-helper task.
- Assistant, Brainstorm, Software, and read-only Project review chat modes.
- Locally saved, exact-step workflows replayed through the same permission gateway.
- User-authored Skills that provide reusable task guidance for coding, coaching, business, education, and research; enabled skills are surfaced to the assistant and loaded only when relevant. After a completed local workflow, ask Mike Assist to draft reusable guidance; the full skill must be approved before it is saved.
- Read-only project overview/review that surfaces repository instruction files and requires key files to be read before reporting findings.
- `list_dir`, `read_file`, bounded text extraction from approved PDFs, Word `.docx` documents and Excel `.xlsx` workbooks, and `write_file`, restricted to approved folders. Folder pages resume with `startIndex`; text excerpts with `startByte`; PDF excerpts with `startPage` and `startChar`; Word excerpts with `startChar`; Excel worksheet pages with `startSheet` and `startRow`. Scanned PDFs need OCR, which is not included; Office embedded images are not analyzed, macros are not executed, and Excel values are raw without number/date formatting.
- Coding command execution in approved writable folders; each exact command requires typed **RUN** approval. The runner filters common credential and code-loader environment variables and best-effort redacts secrets in captured output.
- Programmable code runs in a separate Electron utility process. Each run shows the exact script for typed **RUN** approval; nested Mike Assist calls must be named explicitly and each goes through the permission gateway. Scripts still run with your Windows account permissions and are not an OS sandbox.
- Reversible coding writes: before each assistant `write_file`, Mike Assist saves a local restore point. The assistant can list, restore, or redo a change only inside its approved folder, with one-time approval and a current-file hash check. Checkpoints are bounded to 10 per file, 100 total, 5 MB per file, and 100 MB overall; they are stored in `file-checkpoints.sqlite` and included in user backups.
- Multiple folder grants, read-only access, and revocation. The built-in Workspace grant cannot be removed or downgraded.
- Write previews, per-call approval, and fail-closed denials and timeouts.
- Append-only JSONL audit trail; API keys encrypted with Electron `safeStorage` when available.
- Summary guard: a summary write is held until the source folder is listed and all listed supported text, PDF, Word, and Excel files have been read.
- SQLite-backed conversation sessions with local message and tool context history.
- Visual chat for PNG, JPEG, and WebP images. Choose a vision-capable model. Image bytes stay in the local conversation database and may be sent again with follow-up turns while in context; the composer shows the configured model destination.
- Approval-gated local search across prior conversation excerpts for continuity; personal-coach, business-coach, and ordinary chats remain separated, and untagged legacy messages are omitted from search.
- Optional session-scoped approval for an exact tool, scope, and argument fingerprint; these approvals are memory-only and cleared when the app closes.
- JSONL audit export and a visible SHA-256 integrity check for chained events.
- Local Markdown note search/create, opt-in Tavily web search with per-query approval, allowlisted read-only HTTPS fetch, and approval-gated `.eml`/`.ics` drafts.
- Visible, isolated browser automation for allowlisted HTTPS sites: approved page inspection, exact-label clicks, and non-password form filling; form submission remains a separately approved click.
- First-run safety onboarding, consistent SQLite-backed local backups, and Windows NSIS packaging.
- Optional voice input via a user-configured loopback-only OpenAI-compatible transcription endpoint.
- Local finance ledger for categorized income/expenses with weekly/monthly reports grouped by currency (no FX conversion); it never connects to banks or moves money.
- Personal memory: user-approved facts in four scopes with keyword recall and citation; every save is shown as an approval card, and the Memory view can edit, archive, or permanently delete facts.
- Activity view over the append-only audit trail with a plain-language summary, plus a detailed raw log.
- Chat command palette: `/remember [scope] fact`, `/recall keywords`, and `/ask question`.
- Typed confirmations for close-to-irreversible actions (`send`, `delete`, `post`, `buy`, `run`): the approval card requires typing a token and never offers session approval.
- MCP connections through user-provided stdio commands or HTTPS/loopback HTTP servers; Claude-Desktop-style JSON import is supported.
- Optional Google Calendar connection with an approval-gated event panel in Today, Chat lookup/create/edit tools, and local prep-task conversion; desktop OAuth uses PKCE, and the app never adds guests or sends guest notifications.
- Calendar events offer a **Prepare meeting** action that opens a reviewable Chat draft using local Knowledge Vault notes and, when connected, Google Drive files. Sending the prompt is manual; Drive searches and each file read still require approval.
- Optional Gmail connection for bounded, paged search, plain-text reading, unsent drafts, and direct email sending. Searches, reads, and drafts require approval; sending also requires typed **SEND** confirmation. Today can create a local follow-up task from a selected search result with separate approval.
- Dedicated Email view for searching connected Gmail and Outlook accounts from one place; every search page and local follow-up task still requires separate approval. Results stay in the view, and follow-up tasks keep the message ID and a subject-based title rather than the body or snippet.
- Optional Google Drive connection for approval-gated search and bounded reading of Docs, Sheets, Slides, PDFs, DOCX, XLSX, and text files. It requests broad read-only Drive access and never edits or deletes files.
- Optional Google Tasks and Microsoft To Do connections for reading lists, creating local-task copies, and explicitly updating linked provider tasks. Each read, create, and update asks for approval. Update reviews compare the remote version and stop if that copy changed. Old read-only connections must be reconnected to grant write scope.
- Optional Outlook Calendar connection for read-only event lookup in Today and Chat, with approval for every event page and local prep-task conversion.
- Optional Outlook Mail connection for read-only mailbox search and selected-message reading in Chat, plus an approval-gated Today follow-up task action from selected search results. Every search page, read, and task creation needs approval.
- Optional Microsoft OneDrive connection for approval-gated search and bounded reading of PDF, DOCX, XLSX, and supported plain-text files. It uses delegated `Files.Read` access and cannot change files.
- MCP tools are namespaced, capped at 24 tools per server, validated against declared JSON Schema, and treated as external/untrusted with approval required on every call.
- Research Desk for focused projects and allowlisted source capture, with one-click saving into the local Knowledge Vault.
- SQLite FTS5 Knowledge Vault for searchable research, teaching notes, and durable personal knowledge.
- Today view with an inbox, priorities, due dates, completion state, and gateway-backed assistant tools. Tasks can carry explicit one-time reminders delivered as local desktop notifications while Mike Assist is running. After an approved Gmail or Outlook search and a separate local task approval, a selected message can become a follow-up task. The quick action stores only the provider and message ID plus a title based on the subject; it does not copy the message body or snippet into task notes.
- Scheduled agent check-ins that run one-time, daily, weekday, or weekly prompts in isolated sessions, with editable personal, business, and study routine starters. Each write or external action keeps its normal approval; scheduled runs cannot run commands or create nested schedules. Mike Assist must be open.
- LB English teaching packs for IELTS Academic Writing, Speaking, Task 1, Turkish L1 error clinics, and realistic band-6.5 study sprints.
- Smart coaching for Personal life and Business / LB English, with area-specific context, coaching chats, goals, private-by-default reflections, and explicit journal consent.
- Coaching goals can be decomposed into milestones and updated or completed through approval-gated assistant actions.
- Coaching milestones can be promoted into linked Today tasks, keeping reflection, goals, and action in one local loop.
- Integrations hub that makes local capabilities, MCP connectors, data access, and approval boundaries visible in one place.

## Quick start

Requirements: Node.js 22.13 or later and npm.

```bash
npm install
npm run dev
```

If Electron's binary was skipped during installation:

```bash
node node_modules/electron/install.js
```

The default provider is Ollama at `http://127.0.0.1:11434/v1`, using `qwen2.5:3b`:

```powershell
ollama pull qwen2.5:3b
$env:OLLAMA_CONTEXT_LENGTH = '8192'
ollama serve
```

Set `OLLAMA_CONTEXT_LENGTH` **before** starting Ollama. The OpenAI-compatible `/v1` API ignores context-length request options; **Test connection** checks the native API and reports the context actually loaded. If Ollama is already running in the tray, stop it before starting another server.

Use **Settings** to configure LM Studio, OpenAI, or another compatible server. Remote providers receive the conversation and context sent to them; use a local provider if that is not acceptable. Remote endpoints must use HTTPS, and credentials must go in the API key field rather than the URL. API keys are never returned to the renderer. If OS-backed encryption is unavailable, a newly entered key is held in memory for the session and is not persisted.

To connect another OpenAI-compatible client, start **Settings → Local OpenAI-compatible API**. Copy its base URL, the configured model name, and the bearer token into the client. The server is disabled by default, binds only to `127.0.0.1`, and stops when Mike Assist closes. Each request supplies its own message history; system and developer messages are treated as client-provided context, and the API transcript is not saved. Tool calls use the normal gateway: local reads can use your approved folders, while writes and external actions wait for approval in Mike Assist. Only one assistant task can run at a time. The API supports `/v1/models` and `/v1/chat/completions` with text messages, inline PNG/JPEG/WebP image data, and optional SSE streaming; remote image URLs and multiple completions are not supported. The requested model must match the configured one; an optional `mode` can select `assistant`, `brainstorm`, `software`, `review`, `coach_personal`, or `coach_business`.

Web search is optional. Add a Tavily API key in **Settings → Web search**; searches send the query and key to Tavily only after you approve the per-query permission card. Search results are untrusted, may use credits on your Tavily plan, and their domains must be allowlisted separately before `web_fetch` can open them.

Google Calendar is optional. Enable the Google Calendar API in a Google Cloud project, create a **Desktop app** OAuth client, add your OAuth Client ID in **Settings → Google Calendar**, and connect through the system browser. Google requires Calendar scope verification for public apps, and projects in testing may require your account to be added as a test user. Mike Assist uses PKCE and requests `calendar.events.owned`; event reads, creates, and edits each need approval. In Today, load today’s event pages with per-page approval and create a local prep task from a selected event with separate approval. Chat can also read events and create local prep tasks. Tasks store the event ID to prevent duplicate conversions and never change the calendar. The app does not expose delete actions, add attendees, or send guest notifications. Refresh tokens are stored with OS encryption when available; if it is unavailable, the connection lasts for the current session only. Disconnecting clears the token locally. Remove Mike Assist in your Google Account to revoke the project grant; doing so can also disconnect Gmail, Drive, and Tasks connected through that project.

Gmail is optional. Enable the Gmail API in your Google Cloud project, use a **Desktop app** OAuth client in **Settings → Gmail**, and connect through the system browser. The same client ID as Calendar can be reused when Gmail API is enabled. Mike Assist requests only `gmail.readonly` and `gmail.compose`; Google classifies both as restricted scopes. Personal use and development/testing have exceptions, while public distribution requires the applicable OAuth verification and may require a security assessment if restricted-scope data is stored or transmitted through third-party servers. The compose scope supports draft creation and sending. Searches are bounded and paged; attachments are not opened. Creating a draft leaves it unsent. Every search, read, and draft requires approval; sending requires a separate approval card and typing **SEND**. In Today, you can approve a search and separately approve creation of a local follow-up task from one selected result. That action stores the message ID and a title based on the subject; it does not copy the snippet or message body into task notes. Gmail results displayed in Today stay in renderer memory; Chat tool results and the assistant's reply stay in memory for the current session and are not saved to local chat history. When you approve a Chat action, its relevant content is sent to the configured model provider, which may be remote. Mike Assist uses Google Workspace data only for these visible Gmail features and follows Google's Limited Use requirements. Refresh tokens are encrypted with OS storage when available; otherwise the connection is session-only. Disconnecting clears the token locally. Remove Mike Assist in your Google Account to revoke the project grant; doing so can also disconnect Calendar, Drive, and Tasks connected through that project.

Google Drive is optional. Enable the Drive API in your Google Cloud project, create a **Desktop app** OAuth client, enter it in **Settings → Google Drive**, and connect through the system browser. Mike Assist requests `drive.readonly`, which provides broad read/download access and is a restricted scope. Public OAuth apps using restricted scopes need Google verification; sending or storing restricted Drive data through servers requires a security assessment. Drive searches and reads each ask for approval. The app extracts bounded text from Google Docs, Sheets (first worksheet only), Slides, PDF, DOCX, XLSX, and supported plain-text files; it does not edit or delete files or read unsupported binary formats. PDF, Word, and Excel extraction reuses the same local parsers as approved-folder files, in memory without saving temporary copies. Approved filenames and file extracts are sent to the configured model provider, which may be remote, and are stored with ordinary chat history. Refresh tokens are encrypted with OS storage when available; otherwise the connection is session-only. Disconnecting clears the token locally. Remove Mike Assist in your Google Account to revoke the project grant; doing so can also disconnect Calendar, Gmail, and Tasks connected through that project.

Google Tasks is optional. Enable the Google Tasks API in the Google Cloud project, enter a **Desktop app** OAuth Client ID in **Settings → Google Tasks**, and connect through the system browser. The same client ID used for Calendar, Gmail, or Drive can be reused when the Tasks API is enabled in that project. Mike Assist requests the broad `tasks` scope, which permits reading, creating, editing, organizing, and deleting tasks; Mike Assist exposes reads, creates, and updates of explicitly linked tasks, and requires approval for each call. In Today, load and choose a Google Tasks list, select a local task, and choose **Review send** or **Review update**; you can also ask Mike Assist in Chat. The preview shows the title, notes, due date, destination, and the fact that priority remains local. Updates read the linked task and compare its saved ETag before applying a conditional update; if the remote version changed, Mike Assist stops without overwriting it. Existing `tasks.readonly` connections remain read-only until disconnected and reconnected in Settings. Disconnecting clears Mike Assist's saved token locally. Remove the app's authorization in your Google Account to revoke it; revoking a Google project grant can affect other services connected through that project. Refresh tokens are encrypted with OS storage when available; otherwise the connection is session-only.

See Google's [task patch API](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks/patch) and [ETag guidance](https://developers.google.com/workspace/tasks/performance) for the provider update behavior.

Microsoft To Do is optional. In Microsoft Entra, register a public-client app that supports personal Microsoft accounts and work or school accounts, enable public-client flows, and add delegated Microsoft Graph `Tasks.ReadWrite`. Enter its Application (client) ID in **Settings → Microsoft To Do**. Sign-in uses Microsoft's device-code page and requests `Tasks.ReadWrite` plus `offline_access`. This permission allows broad task and list changes; Mike Assist exposes reads, creates, and updates of explicitly linked tasks, and requires approval for each call. In Today, load and choose a Microsoft To Do list, select a local task, and choose **Review send** or **Review update**; you can also ask Mike Assist in Chat. The preview shows the title, notes, due date, priority, and destination. Before updating, Mike Assist reads the exact linked task, checks its saved ETag and fields, and stops if it changed. Existing `Tasks.Read` connections remain read-only until disconnected and reconnected in Settings. Results shown directly in Today stay in the app; approved results requested in Chat may be sent to your configured model provider and saved in chat history. Disconnecting clears Mike Assist's saved token locally; the Microsoft authorization remains until removed from the Microsoft account or organization. Refresh tokens are encrypted with OS storage when available; otherwise the connection is session-only. See Microsoft's [device-code sign-in guide](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code), [create task API](https://learn.microsoft.com/en-us/graph/api/todotasklist-post-tasks?view=graph-rest-1.0), [update task API](https://learn.microsoft.com/en-us/graph/api/todotask-update?view=graph-rest-1.0), [list task lists](https://learn.microsoft.com/en-us/graph/api/todo-list-lists?view=graph-rest-1.0), and [list tasks](https://learn.microsoft.com/en-us/graph/api/todotasklist-list-tasks?view=graph-rest-1.0).

Outlook Calendar is optional and has a separate connection from Microsoft To Do. In Microsoft Entra, register a public-client app that supports personal Microsoft accounts and work or school accounts, enable public-client flows, and add delegated Microsoft Graph `Calendars.ReadBasic`. Enter the Application (client) ID in **Settings → Outlook Calendar** and sign in through the Microsoft device-code page. Mike Assist requests only `Calendars.ReadBasic` plus `offline_access`; it reads the default calendar through a fixed, read-only `calendarView` route, bounds each query to at most 31 days, asks for approval for every page, and requests event times in UTC before displaying them in local time. In Today, choose **Create prep task** on a selected event to create an approval-gated local task due on the event's local date. The task stores the event ID to prevent duplicate conversions; the calendar event itself is never changed. Event titles and locations stay local when loaded from Today; approved results requested in Chat may be sent to your configured model provider and saved in chat history. Disconnecting clears Mike Assist's saved token locally; the Microsoft authorization remains until removed from the Microsoft account or organization. Refresh tokens are encrypted with OS storage when available; otherwise the connection is session-only. See Microsoft's [device-code sign-in guide](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code), [calendarView API](https://learn.microsoft.com/en-us/graph/api/user-list-calendarview?view=graph-rest-1.0), and [permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference).

Outlook Mail is optional and has its own separate Microsoft connection. In Microsoft Entra, register a public-client app that supports personal Microsoft accounts and work or school accounts, enable public-client flows, and add delegated Microsoft Graph `Mail.Read`. Enter the Application (client) ID in **Settings → Outlook Mail** and sign in through the Microsoft device-code page. Mike Assist requests only `Mail.Read` plus `offline_access`, searches bounded pages of message headers, and reads the body only for one selected message in Chat. Each search and message read asks for approval. In Today, you can separately approve creating a local follow-up task from a selected search result; that task stores the message ID and a title based on the subject without copying message text into notes. Sending, drafting, deleting, and changing mail are not available. Message contents are untrusted; approved results used in Chat may be sent to your configured model provider. Outlook Mail results shown in Today stay in renderer memory; Chat results and the assistant reply stay in memory for the current session and are not saved in local chat history. Disconnecting clears Mike Assist's saved token locally; the Microsoft authorization remains until removed from the Microsoft account or organization. Refresh tokens are encrypted with OS storage when available; otherwise the connection is session-only. See Microsoft's [device-code sign-in guide](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code), [list messages API](https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0), [get message API](https://learn.microsoft.com/en-us/graph/api/message-get?view=graph-rest-1.0), and [permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference).

Microsoft OneDrive is optional and uses its own separate Microsoft connection. In Microsoft Entra, register a public-client app that supports personal Microsoft accounts and work or school accounts, enable public-client flows, and add delegated Microsoft Graph `Files.Read`. Enter the Application (client) ID in **Settings → OneDrive** and sign in through the Microsoft device-code page. Mike Assist requests only `Files.Read` plus `offline_access`; each search and selected file read asks for approval. Reads are bounded to 1.5 MB for plain text or 25 MB for PDF, DOCX, and XLSX; unsupported file formats are rejected. Searches and reads are read-only. File names, metadata, and extracted contents are untrusted; approved results and assistant replies may be sent to your configured model provider and saved in ordinary chat history. Disconnecting clears Mike Assist's saved token locally; the Microsoft authorization remains until removed from the Microsoft account or organization. Refresh tokens are encrypted with OS storage when available; otherwise the connection is session-only. See Microsoft's [device-code sign-in guide](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code), [file search API](https://learn.microsoft.com/en-us/graph/api/driveitem-search?view=graph-rest-1.0), [file download API](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0), and [permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference).

The first-run guide explains the permission model and data locations. Optional voice input is disabled until you configure a local server implementing `/v1/audio/transcriptions` in **Settings**. Recordings are sent only to loopback endpoints and are not saved to disk. In **Voice chat** mode, push-to-talk transcripts are sent to the configured model provider, and assistant replies use an installed local OS voice; use a local model provider to keep transcripts on-device. Mike Assist does not install or launch speech software.

On Windows, `npm run dist:win` creates `release\Mike-Assist-Setup-0.1.0.exe`. No signing certificate is included, so Windows may show a SmartScreen warning. Uninstalling preserves app data under `%APPDATA%\Mike Assist`.

## Using the app

1. Open **Settings → Test connection** to confirm the provider and model support tool calling.
2. Add folders with the native picker and choose **Read only** or **Read and write**. Workspace is created under `Documents\Mike Assist Workspace`.
3. Ask the assistant to inspect or read files. Reads run automatically inside approved folders.
4. Review each write preview and choose **Approve once**, **Allow exact action this chat**, or **Deny**. Session approvals match only the exact tool, approved scope, and arguments; they are cleared when Mike Assist closes.
5. Use **Queue task** to prepare multiple prompts, then **Run queue**. Tasks execute one at a time; **Stop** halts the active task and pauses the queue.
6. Choose **Brainstorm**, **Software**, or **Project review** mode. Project review is read-only; Software mode reads applicable repository guidance and plans before editing. Build, test, and development commands run only from approved writable folders after you inspect the exact command and type **RUN**.
7. After a successful tool-based task, choose **Save completed steps as workflow**. Replaying repeats exact recorded arguments; review and approve each write again.
8. Use **Review my project** or ask for a project check. The assistant maps the approved folder, reads key files, and reports findings without changing files.
9. Enable **Voice chat** for push-to-talk transcripts and locally spoken replies. Voice chat auto-sends transcripts to the configured model provider; use a local model for on-device conversations.
10. Open **Finances** to review weekly/monthly totals by currency and category. Chat can record an entry, but each ledger write requires approval. Use **Settings → Backup** for a consistent snapshot of chats, finance records, memory facts, research, vault, plans, workflows, skills, settings, grants, allowlisted domains, voice settings, web-search settings, Google Calendar, Gmail, Google Drive connections, and audit logs.
11. In chat, `/remember IELTS students meet weekly` (optionally prefixed with a scope like `teaching`) saves an approved fact; `/recall keywords` finds facts with `[M#]` citations; `/ask question` sends a normal request. The assistant also automatically recalls matching facts before each turn and cites them.
12. Open **Memory** to review, edit, archive, or permanently delete saved facts, and open **Activity** for a friendly record everything Mike Assist did (or the detailed append-only log).
13. Use **Today** for next actions and quick capture, **Research** for focused source collection, and **Knowledge Vault** for durable searchable notes. Add a reminder only for tasks you want a Windows notification about. Notifications appear while Mike Assist is running; an overdue reminder appears once the next time it opens.
14. In **LB English**, start an IELTS or teaching pack in chat and adapt the generated lesson to the learner in front of you.
15. In **Settings → MCP connections**, add a local command or server URL, or import an `mcpServers` JSON block. Mike Assist never installs servers or forwards its full environment; the MCP SDK supplies a small set of platform variables. Disable or remove a connection to unregister its tools.
16. Open **Coach** for Personal life or Business / LB English. Starting a coach chat opens a separate conversation and uses only that area’s saved goals, journal entries, and memory facts. **Discuss with AI coach** sends a check-in to your configured model and keeps it in chat history; **Save reflection** stores it in the private journal after approval.
17. Use **Review with AI** after saving useful context to discuss progress and choose a small next step; goals can carry milestones, and the coach does not set reminders or act in the background.
18. Connect Google Calendar in **Settings** to let chat read, create, and update events. Every operation displays an approval card; invitees and meeting links are not added, and guest notifications are disabled. You can also approve conversion of a selected event into a local prep task without modifying the calendar.
19. Connect Gmail in **Settings** to search and read selected messages, save unsent drafts, or send an email after approval. The send card shows recipients, subject, and full plain-text body, then requires you to type **SEND**. Attachments are not opened or sent.
20. Connect Google Drive in **Settings** to search file names and contents, then read selected Docs, Sheets, Slides, PDF, DOCX, XLSX, or supported text files after approval. Continue long document reads with the returned page, row, sheet, or character cursor; the assistant treats file content as untrusted.
21. Open **Skills** to save reusable instructions for the work you do often. Give each skill a short description so the assistant can select it; Personal coach sees Personal and General skills, while Business coach sees Business, Education, and General skills. Loaded skill text is included in the current model request and cannot grant tool permissions.
22. For another local client, enable **Settings → Local OpenAI-compatible API**, then copy the displayed base URL, configured model name, and bearer token. Turn it off when you no longer need it.

For a short, fixed dependent workflow, the assistant can use a later step argument like `{ "$fromStep": 0, "path": "output.id" }` to pass an earlier result forward. For meaningful loops or branching, it can use `execute_code` and call only the already-loaded tools listed in `enabledTools` with `await tools.call(name, args)`. Independent reads remain parallel; every nested call still asks for its normal approval.

Tool paths are relative to a grant. The `root` argument may be a grant label; omit it to use Workspace. Absolute paths, parent-directory escapes, network shares, and symlink escapes are rejected. Removing a folder grant revokes access but never deletes files.

## Safety model

1. **The model proposes; the gateway disposes.** Every registered tool call passes through the gateway.
2. **Unknown by default.** Unknown tools, invalid arguments, and tools without an explicit policy are blocked.
3. **Writes ask.** Local reads are allowed; every write tool requires approval. Approval requests expire after 60 seconds.
4. **Hard blocks cannot be overridden.** `destructive` and `privileged` risks are always blocked. Local commands and generated code require typed per-call **RUN** approval and run under your Windows account; the working directory is approved, but these processes are not OS-sandboxed. Common credential and code-loader environment variables are filtered, and captured output receives best-effort secret redaction. Task reminders are local notifications; they appear while Mike Assist is running, or once on the next launch if overdue. Gmail sends require one-time approval and typing **SEND**. There are no payment tools or unrestricted desktop automation.
5. **External services are permission-gated.** Tavily search uses one fixed HTTPS endpoint and asks on every query. Google Calendar reads, creates, and updates ask every time; its refresh token is OS-encrypted when available, and the app never adds guests. Gmail search, read, and draft actions ask every time; sending also requires typed **SEND**. Gmail and Calendar results are untrusted. Approved Gmail content is sent to the configured model provider for the requested feature; Gmail tool results and the resulting assistant reply are kept in memory for the active session and omitted from durable chat and provider history. Google Drive search and file reads ask every time, use a fixed API host and read-only API routes, and return untrusted metadata/content. Drive file extracts and assistant replies may be saved in chat history and sent to the configured model provider. Page fetch is read-only and limited to exact HTTPS domains in Settings; its DNS is checked and pinned to public addresses, and redirects must remain allowlisted. The visible browser uses a separate in-memory session and a loopback HTTPS CONNECT proxy that resolves each requested host, rejects private/reserved addresses, and pins the tunnel to a validated public IP. It denies site permissions and downloads and asks before every open, inspection, click, or fill. Page contents are untrusted; password fields cannot be filled, and a click may submit or change a website. External results taint later writes, which still require explicit approval.
6. **Scope is checked twice.** The gateway validates the approved-folder scope before policy evaluation and again after approval, then passes the validated canonical path to the tool.
7. **Fail closed.** Tool and approval timeouts, denials, audit write errors, and revoked or downgraded grants prevent execution.
8. **Audit contains metadata, not content.** Chat records store role and character count. Tool records store names, summaries, argument hashes, decisions, and outcomes—not messages, file contents, memory facts, or API keys. Memory recall records only counts.
9. **Tool results are untrusted.** They return as tool messages, not instructions. Summary writes require source text to have been read. Sequences accept only already-loaded tools; code runs can call only explicitly enabled, already-loaded tools through the gateway, while the approved script itself retains normal Windows account access.
10. **Renderer is sandboxed.** Context isolation, disabled Node integration, sandboxed preload, typed IPC, blocked navigation/popups, and denied browser permissions.
11. **Voice is opt-in and local-only.** Microphone access is requested only after you press Voice, and recordings are sent only to your configured loopback transcription server.
12. **MCP is permission-gated.** Server annotations are untrusted and cannot lower risk. MCP tools always ask, server-initiated sampling/roots/elicitation are refused, and external results taint later writes.
13. **Coaching respects consent.** Personal life and Business / LB English context are separated by area. Check-in text stays in the Coach view unless you choose to send it to chat or save it to the journal. Coaching never diagnoses or makes high-stakes decisions for the user.
14. **Scheduled runs are bounded.** User-authored prompts run in temporary, unpersisted sessions with a unique approval scope. The saved prompt and latest result stay in the local schedule file. Writes and external actions keep their normal approval rules; runs cannot execute commands or create nested schedules. Runs wait while a foreground task is active and recurring schedules use this computer's local time.
15. **Helper delegation is explicit and bounded.** One approval can send up to four independent tasks to separate helpers concurrently. Each configured-model request is listed in the preview; each helper has a separate session, read-only file/note/vault tools, and allowlisted URL fetch. Batch helpers cannot perform interactive web search, so do that in the main chat first or use a single helper. Helpers cannot access saved memory, coaching, finance, Today tasks, calendar data, email, or skills; write, run commands, use MCP/browser actions, or start another helper. Helper results are treated as untrusted external content.
16. **The local API is opt-in and loopback-only.** Its random bearer token lasts only for the current app session. Each request receives a transient agent session, shares the approval UI and single-task lock, and does not persist its transcript. The client must be trusted because it can request available reads and ask the assistant to propose any enabled tool action.

## Data locations

| Data | Location |
|---|---|
| Built-in workspace | `%USERPROFILE%\Documents\Mike Assist Workspace` |
| Audit log | `%APPDATA%\Mike Assist\audit\YYYY-MM.jsonl` |
| Folder grants | `%APPDATA%\Mike Assist\grants.json` |
| Provider settings | `%APPDATA%\Mike Assist\settings.json` |
| Web search settings | `%APPDATA%\Mike Assist\web-search.json` (key encrypted by Windows when available) |
| Google Calendar settings | `%APPDATA%\Mike Assist\google-calendar.json` (refresh token encrypted by Windows when available) |
| Gmail settings | `%APPDATA%\Mike Assist\google-gmail.json` (refresh token encrypted by Windows when available) |
| Google Drive settings | `%APPDATA%\Mike Assist\google-drive.json` (refresh token encrypted by Windows when available) |
| Google Tasks settings | `%APPDATA%\Mike Assist\google-tasks.json` (refresh token encrypted by Windows when available) |
| Microsoft To Do settings | `%APPDATA%\Mike Assist\microsoft-todo.json` (refresh token encrypted by Windows when available) |
| Outlook Calendar settings | `%APPDATA%\Mike Assist\microsoft-calendar.json` (refresh token encrypted by Windows when available) |
| Outlook Mail settings | `%APPDATA%\Mike Assist\microsoft-mail.json` (refresh token encrypted by Windows when available) |
| Microsoft OneDrive settings | `%APPDATA%\Mike Assist\microsoft-onedrive.json` (refresh token encrypted by Windows when available) |
| Conversation memory | `%APPDATA%\Mike Assist\conversations.sqlite` |
| Finance ledger | `%APPDATA%\Mike Assist\finance.sqlite` |
| Personal memory | `%APPDATA%\Mike Assist\memory.sqlite` |
| Web domain allowlist | `%APPDATA%\Mike Assist\allowed-domains.json` |
| Voice endpoint | `%APPDATA%\Mike Assist\speech.json` |
| Saved workflows | `%APPDATA%\Mike Assist\workflows.json` |
| Scheduled tasks and last results | `%APPDATA%\Mike Assist\scheduled-tasks.json` |
| User-authored skills | `%APPDATA%\Mike Assist\skills.json` |
| MCP connections | `%APPDATA%\Mike Assist\mcp-servers.json` |
| Research Desk | `%APPDATA%\Mike Assist\research.sqlite` |
| Knowledge Vault | `%APPDATA%\Mike Assist\vault.sqlite` |
| Plans / Today | `%APPDATA%\Mike Assist\planning.sqlite` |
| Coaching profile and journal | `%APPDATA%\Mike Assist\coaching.sqlite` |
| File restore points | `%APPDATA%\Mike Assist\file-checkpoints.sqlite` |

Conversation text, provider context for ordinary turns (including tool results), and attached image bytes are stored locally in `%APPDATA%\Mike Assist\conversations.sqlite`; approved Gmail and Outlook Mail results and the assistant replies are session-only and excluded from local chat history. Approved Google Drive and OneDrive extracts, Google Tasks results, Microsoft To Do results, Outlook Calendar results, and replies are part of ordinary chat history. Results loaded directly in the Today remote-service panels stay in renderer memory and are not added to chat history. The standalone Cloud Files view also keeps extracts in renderer memory; choosing **Prepare Chat draft** only fills the composer, and the extract enters chat history or goes to the configured model only if you choose **Send**. They are separate from the audit log; remote providers receive the conversation sent to them, including selected images while those images remain in model context, and a remote provider receives a skill's full text when the assistant loads it. SQLite data is not separately encrypted at rest; protect the Windows account/device and choose backup locations carefully. Skills are stored as plain text in `skills.json`. Existing pre-M2 audit records remain readable but are reported as legacy/unverified; new records are SHA-256 chained. A chain integrity failure blocks further audit appends and therefore blocks gateway actions.

When conversation search is approved, at most eight matching excerpts from the current context area are sent to the configured model. Coach searches stay within the active Personal or Business / LB English area; ordinary chats exclude both coach areas. Messages saved before mode tagging was introduced have unknown context and are left out of search, but remain available in their conversation sessions.

The finance ledger and saved workflow templates are also local app data. The audit log does not store transaction amounts, notes, conversation text, or workflow arguments.

Memory facts are plain rows in `memory.sqlite`. The model can only add or archive facts by showing an approval card, and it can only read facts through keyword recall that never stores content in the audit log. Editing and restoring happen on the Memory view; deleting is permanent and requires typing DELETE on that fact's card.

## Project layout

```text
src/
  main/              Electron main process, IPC, native folder picker
  preload/           Sandboxed contextBridge API
  renderer/          React chat, command center views, approval modal, settings, audit UI
  core/              Agent, gateway, scheduler, stores, providers, audit
  core/mcp/          MCP connection store, naming, transport manager, tool registration
  tools/             Filesystem, project review, code runner, finance, memory, drafts, constrained web, Gmail, Google Calendar, Google Drive, OneDrive and Tasks
  shared/            Types, IPC contracts, and provider presets
tests/               Agent, provider, image attachment, gateway, grant, settings, and path tests
```

## Scripts

```bash
npm run dev        # Electron + Vite development app
npm run build      # Production bundles in out/
npm run package:dir # Unpacked Windows app in release/win-unpacked
npm run dist:win   # NSIS installer in release/
npm run preview    # Run the production bundle
npm run typecheck  # Strict TypeScript check
npm test            # Vitest suite
```

The NSIS installer is unsigned because no code-signing certificate is configured; Windows may show a SmartScreen warning. The installer preserves `%APPDATA%\Mike Assist` when uninstalled.

## Roadmap

- **M0 — complete:** walking skeleton, gateway, filesystem tools, approval UI, audit log.
- **M1 — complete:** real provider, agent loop, settings, multiple folder grants, streaming, cancellation, and adversarial tests.
- **M2 — complete:** SQLite chat sessions, exact session-scoped approvals, audit export, and hash-chain verification.
- **M3 — complete:** local note tools, read-only project overview/review, allowlist-only web fetch, unsent `.eml` drafts, and `.ics` calendar drafts.
- **M4 — complete:** first-run onboarding, consistent backups, Windows NSIS installer, and opt-in loopback-only voice transcription.
- **Stage 1 — complete:** the spine of the personal command center: personal memory (approved saves, keyword recall with `[M#]` citations, Memory view with edit/archive/delete), the Activity view, typed approval cards, and the `/remember` `/recall` `/ask` palette.
- **Stage 2 — complete:** user-configured MCP connections with stdio/HTTP transports, namespaced tool registration, JSON Schema validation, Claude-Desktop-style import, untrusted-result tainting, and approval on every MCP call.
- **Stage 3 — complete:** Research Desk projects, gateway-routed allowlisted source capture, source notes, and research-to-vault capture.
- **Stage 4 — complete:** local SQLite FTS5 Knowledge Vault, searchable documents, tags, editing, deletion, and assistant tools.
- **Stage 5 — complete:** Today, Plans, and Inbox with local tasks, priorities, due dates, conversion, completion, and assistant tools.
- **Stage 6 — complete:** LB English teaching packs for IELTS Academic and Turkish-speaking learners, launched directly into chat for adaptation.
- **Coaching foundation — complete:** separate Personal life and Business / LB English coach modes, area-scoped goals, journal and memory context, editable boundaries and style, approval-gated goal and journal changes, and weekly reviews.
- **Task follow-through — complete:** optional one-time task reminders, local Windows notifications, explicit reminder controls, and isolated scheduled agent check-ins with approval-gated writes and external access.
- **Reusable Skills — complete:** user-authored, scoped guidance can be loaded on demand or drafted from a completed local workflow at the user's request; the full skill is shown for approval before saving. Skill content is plain text, private coach modes only see relevant categories, skills are included in backups, and they cannot bypass the tool permission gateway.
- **Web research and browser actions — complete for this increment:** optional Tavily search with encrypted key storage, fixed-host DNS-pinned fetch, exact-domain HTTPS allowlisting, visible isolated browser, a DNS-pinned HTTPS tunnel, bounded page inspection, exact-label interactions, session-only browser storage, and one-time approvals for each browser action.
- **Calendar connection — complete:** optional Google Calendar desktop OAuth with PKCE, encrypted refresh-token storage, an approval-gated Today event panel with paging, event lookup/create/update tools, local prep-task conversion, and a reviewable meeting-prep Chat draft that can use approved Drive files and local notes.
- **Gmail connection — complete:** optional Gmail desktop OAuth with PKCE, encrypted refresh-token storage, bounded paged search and plain-text read, draft creation, typed-confirmation sending, and approval-gated local follow-up tasks from Today; delete, label, archive, and attachment tools are not exposed.
- **Google Drive connection — complete:** optional Drive desktop OAuth with PKCE, encrypted refresh-token storage, fixed-host read-only API access, approval-gated search, and bounded Docs/Sheets/Slides/PDF/DOCX/XLSX/plain-text reads.
- **Google Tasks connection — complete:** optional desktop OAuth with PKCE, encrypted refresh-token storage, fixed-host task-list/task reads, creation, and conditional updates of linked local tasks, with approval per call and a separate panel in Today.
- **Microsoft To Do connection — complete:** optional device-code OAuth, encrypted refresh-token storage, fixed-host Graph list/task reads, creation, and version-checked updates of linked local tasks, with approval per call and a separate panel in Today.
- **Outlook Calendar connection — complete:** optional device-code OAuth with a separate `Calendars.ReadBasic` token, bounded read-only Graph calendarView paging, per-page approval, an explicitly separate event panel in Today and Chat, approval-gated local prep tasks, and reviewable meeting-prep drafts from selected events.
- **Outlook Mail connection — complete:** optional device-code OAuth with a separate `Mail.Read` token, bounded read-only Graph message search and selected-message reading, per-search/message approval in Chat, and separate approval for local follow-up tasks from Today.
- **Microsoft OneDrive connection — complete:** optional device-code OAuth with a separate `Files.Read` token, fixed-route Graph search and bounded PDF/DOCX/XLSX/plain-text reads, per-search/file approval, and no file mutations.
- **Cloud Files workflow — complete:** a standalone, approval-gated Google Drive and OneDrive search/read view with local read-aloud, Knowledge Vault capture, Today follow-ups, and an optional reviewable Chat draft; speech stays local, opening the draft does not send the extract, and large drafts are bounded to the chat message limit.
- **Integration transparency — complete:** a capability hub for local features and configured MCP servers, with visible data/approval boundaries.
