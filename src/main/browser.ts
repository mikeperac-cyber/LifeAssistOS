import { createHash } from 'node:crypto'
import { BrowserWindow, session, type Session, type WebContents } from 'electron'
import { validateUrl } from '../tools/web'
import type { BrowserActionResult, BrowserAutomation, BrowserPageSnapshot } from '../tools/browser'
import { ToolError } from '../tools/paths'
import { PinnedHttpsProxy } from './pinned-https-proxy'

const PARTITION = 'mike-assist-browser'
const ISOLATED_WORLD_ID = 9876
const MAX_PAGE_TEXT = 12_000
const MAX_ITEMS = 80
const MAX_FIELD_ITEMS = 60

const SNAPSHOT_SCRIPT = `(() => {
  const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
  const visible = element => {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' &&
      Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0 && element.getAttribute('aria-hidden') !== 'true';
  };
  const labelFor = element => {
    const labels = element.labels ? Array.from(element.labels).map(label => normalize(label.innerText)).filter(Boolean) : [];
    return (labels[0] || element.getAttribute('aria-label') || element.getAttribute('placeholder') ||
      element.getAttribute('name') || element.getAttribute('title') || '').slice(0, 180);
  };
  const body = document.body;
  const text = body ? String(body.innerText || '').replace(/\\r/g, '').replace(/[ \\t]+/g, ' ').replace(/\\n[ \\t]+/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim().slice(0, ${MAX_PAGE_TEXT + 1}) : '';
  const linkLabels = Array.from(document.querySelectorAll('a[href]'))
    .filter(visible).map(link => normalize(link.innerText || link.getAttribute('aria-label'))).filter(Boolean)
    .slice(0, ${MAX_ITEMS}).map(label => label.slice(0, 180));
  const buttonLabels = Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]'))
    .filter(visible).map(button => normalize(button.innerText || button.value || button.getAttribute('aria-label'))).filter(Boolean)
    .slice(0, ${MAX_ITEMS}).map(label => label.slice(0, 180));
  const fields = Array.from(document.querySelectorAll('input:not([type="password"]):not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable="true"]'))
    .filter(visible).filter(field => !field.disabled && field.getAttribute('aria-disabled') !== 'true')
    .slice(0, ${MAX_FIELD_ITEMS}).map(field => ({
      label: labelFor(field),
      type: field instanceof HTMLInputElement ? field.type : field instanceof HTMLSelectElement ? 'select' : field instanceof HTMLTextAreaElement ? 'textarea' : 'contenteditable'
    }));
  return { title: normalize(document.title).slice(0, 240), text, links: linkLabels, buttons: buttonLabels, fields };
})()`

function scriptString(value: string): string {
  return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

function safeDisplayUrl(raw: string): string {
  const url = new URL(raw)
  url.hash = ''
  for (const key of [...url.searchParams.keys()]) {
    if (/(token|secret|password|passwd|auth|session|signature|ticket|verifier|credential|(^|_)code($|_)|^state$|(^|_)key($|_))/i.test(key)) {
      url.searchParams.set(key, '[redacted]')
    }
  }
  return url.toString()
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal, onAbort: () => void): Promise<T> {
  if (signal.aborted) {
    onAbort()
    return Promise.reject(new ToolError('The browser action was cancelled.'))
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false
    const cleanup = (): void => signal.removeEventListener('abort', abort)
    const abort = (): void => {
      if (settled) return
      settled = true
      cleanup()
      onAbort()
      reject(new ToolError('The browser action was cancelled.'))
    }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(
      (value) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(value)
      },
      (error: unknown) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }
    )
  })
}

/**
 * Owns a visible remote-content window on its own in-memory Electron session.
 * The website never receives a preload, Node access, app permissions, or file
 * downloads. Every network URL must be HTTPS on a user's exact allowlist.
 */
export class ElectronBrowserAutomation implements BrowserAutomation {
  private readonly browserSession: Session
  private readonly pinnedProxy: PinnedHttpsProxy
  private browserWindow: BrowserWindow | null = null
  private cleanupAfterClose: Promise<void> = Promise.resolve()
  private proxyReady: Promise<void> | null = null

  constructor(private readonly allowsHost: (host: string) => boolean) {
    // No "persist:" prefix: this partition's cookies and storage live only in memory.
    this.browserSession = session.fromPartition(PARTITION)
    this.pinnedProxy = new PinnedHttpsProxy(this.allowsHost)
    this.browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    this.browserSession.setPermissionCheckHandler(() => false)
    this.browserSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      callback({ cancel: !this.requestAllowed(details.url) })
    })
    this.browserSession.on('will-download', (event) => event.preventDefault())
  }

  currentUrl(): string | null {
    const window = this.liveWindow()
    if (!window) return null
    const url = window.webContents.getURL()
    return url ? safeDisplayUrl(url) : null
  }

  currentPageIdentity(): string | null {
    const window = this.liveWindow()
    const url = window?.webContents.getURL()
    return url ? createHash('sha256').update(url).digest('hex') : null
  }

  async open(rawUrl: string, signal: AbortSignal): Promise<{ url: string; title: string }> {
    const url = validateUrl(rawUrl, this.allowsHost)
    await this.cleanupAfterClose
    if (signal.aborted) throw new ToolError('The browser action was cancelled.')
    await this.ensurePinnedProxy()

    const window = this.liveWindow() ?? this.createWindow()
    await raceWithAbort(window.loadURL(url.toString()), signal, () => window.webContents.stop())
    return this.pageAddress(window)
  }

  async inspect(signal: AbortSignal): Promise<BrowserPageSnapshot> {
    const window = this.requireWindow()
    const page = await this.execute<{
      title: string
      text: string
      links: string[]
      buttons: string[]
      fields: BrowserPageSnapshot['fields']
    }>(window.webContents, SNAPSHOT_SCRIPT, signal)
    const text = typeof page.text === 'string' ? page.text : ''
    return {
      ...this.pageAddress(window),
      text: text.slice(0, MAX_PAGE_TEXT),
      links: Array.isArray(page.links) ? page.links.slice(0, MAX_ITEMS) : [],
      buttons: Array.isArray(page.buttons) ? page.buttons.slice(0, MAX_ITEMS) : [],
      fields: Array.isArray(page.fields) ? page.fields.slice(0, MAX_FIELD_ITEMS) : [],
      truncated: text.length > MAX_PAGE_TEXT
    }
  }

  async click(target: string, signal: AbortSignal): Promise<BrowserActionResult> {
    const window = this.requireWindow()
    const encodedTarget = scriptString(target.trim().replace(/\s+/g, ' '))
    const script = `(() => {
      const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
      const visible = element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 &&
          rect.width > 0 && rect.height > 0 && element.getAttribute('aria-hidden') !== 'true';
      };
      const elements = Array.from(document.querySelectorAll('a[href], button, [role="button"], input[type="button"], input[type="submit"]'))
        .filter(visible).filter(element => normalize(element.innerText || element.value || element.getAttribute('aria-label')) === ${encodedTarget});
      if (elements.length === 0) return { ok: false, message: 'No visible link or button has that exact label.' };
      if (elements.length > 1) return { ok: false, message: 'More than one visible link or button has that label; use a more specific label.' };
      elements[0].click();
      return { ok: true, message: 'Clicked the matching visible control.' };
    })()`
    const result = await this.execute<{ ok: boolean; message: string }>(window.webContents, script, signal, true)
    if (!result.ok) throw new ToolError(result.message)
    await this.delay(350, signal)
    return { ...this.pageAddress(window), message: result.message }
  }

  async fill(field: string, value: string, signal: AbortSignal): Promise<BrowserActionResult> {
    const window = this.requireWindow()
    const encodedField = scriptString(field.trim().replace(/\s+/g, ' '))
    const encodedValue = scriptString(value)
    const script = `(() => {
      const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
      const visible = element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 &&
          rect.width > 0 && rect.height > 0 && element.getAttribute('aria-hidden') !== 'true';
      };
      const labelFor = element => {
        const labels = element.labels ? Array.from(element.labels).map(label => String(label.innerText || '').replace(/\\s+/g, ' ').trim()).filter(Boolean) : [];
        return labels[0] || element.getAttribute('aria-label') || element.getAttribute('placeholder') ||
          element.getAttribute('name') || element.getAttribute('title') || '';
      };
      const selector = 'input:not([type="password"]):not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable="true"]';
      const fields = Array.from(document.querySelectorAll(selector)).filter(visible)
        .filter(element => !element.disabled && element.getAttribute('aria-disabled') !== 'true')
        .filter(element => normalize(labelFor(element)) === ${encodedField});
      if (fields.length === 0) return { ok: false, message: 'No visible non-password field has that exact label.' };
      if (fields.length > 1) return { ok: false, message: 'More than one visible field has that label; use a more specific label.' };
      const element = fields[0];
      const value = ${encodedValue};
      if (element instanceof HTMLInputElement) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(element, value);
      } else if (element instanceof HTMLTextAreaElement) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(element, value);
      } else if (element instanceof HTMLSelectElement) {
        if (!Array.from(element.options).some(option => option.value === value || normalize(option.label) === normalize(value))) {
          return { ok: false, message: 'That value does not exactly match an available option.' };
        }
        const option = Array.from(element.options).find(option => option.value === value || normalize(option.label) === normalize(value));
        element.value = option.value;
      } else {
        element.textContent = value;
      }
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, message: 'Filled the matching field without submitting the form.' };
    })()`
    const result = await this.execute<{ ok: boolean; message: string }>(window.webContents, script, signal, true)
    if (!result.ok) throw new ToolError(result.message)
    return { ...this.pageAddress(window), message: result.message }
  }

  dispose(): void {
    if (this.browserWindow && !this.browserWindow.isDestroyed()) this.browserWindow.close()
    this.browserWindow = null
    void this.browserSession.closeAllConnections()
      .catch((error) => console.warn('[browser] could not close proxy connections', error))
      .finally(() => this.pinnedProxy.close())
  }

  private createWindow(): BrowserWindow {
    const window = new BrowserWindow({
      width: 1120,
      height: 780,
      minWidth: 760,
      minHeight: 540,
      show: true,
      autoHideMenuBar: true,
      title: 'Mike Assist Browser',
      webPreferences: {
        session: this.browserSession,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        spellcheck: true
      }
    })
    this.browserWindow = window
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, navigationUrl) => {
      if (!this.allowedUrl(navigationUrl)) event.preventDefault()
    })
    window.webContents.on('will-redirect', (event, navigationUrl) => {
      if (!this.allowedUrl(navigationUrl)) event.preventDefault()
    })
    window.webContents.on('page-title-updated', (event, title) => {
      event.preventDefault()
      const host = this.safeHost(window.webContents.getURL())
      window.setTitle(`Mike Assist Browser${host ? ` — ${host}` : ''}${title ? ` · ${title.slice(0, 72)}` : ''}`)
    })
    window.on('closed', () => {
      if (this.browserWindow === window) this.browserWindow = null
      this.cleanupAfterClose = this.browserSession.clearStorageData().catch((error) => {
        console.warn('[browser] could not clear session data after close', error)
      })
    })
    return window
  }

  private liveWindow(): BrowserWindow | null {
    return this.browserWindow && !this.browserWindow.isDestroyed() ? this.browserWindow : null
  }

  private requireWindow(): BrowserWindow {
    const window = this.liveWindow()
    if (!window) throw new ToolError('Open a web page in the Mike Assist browser first.')
    return window
  }

  private async execute<T>(contents: WebContents, code: string, signal: AbortSignal, userGesture = false): Promise<T> {
    const result = await raceWithAbort(
      contents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [{ code }], userGesture),
      signal,
      () => contents.stop()
    )
    return result as T
  }

  private requestAllowed(rawUrl: string): boolean {
    if (rawUrl.startsWith('data:') || rawUrl.startsWith('blob:') || rawUrl === 'about:blank') return true
    try {
      validateUrl(rawUrl, this.allowsHost)
      return true
    } catch {
      return false
    }
  }

  private allowedUrl(rawUrl: string): boolean {
    try {
      validateUrl(rawUrl, this.allowsHost)
      return true
    } catch {
      return false
    }
  }

  private safeHost(rawUrl: string): string {
    try {
      return new URL(rawUrl).hostname
    } catch {
      return ''
    }
  }

  private async ensurePinnedProxy(): Promise<void> {
    if (!this.proxyReady) {
      this.proxyReady = this.pinnedProxy.start().then(async (port) => {
        await this.browserSession.setProxy({
          mode: 'fixed_servers',
          proxyRules: `https=127.0.0.1:${port}`,
          proxyBypassRules: '<-loopback>'
        })
        await this.browserSession.closeAllConnections()
      }).catch((error: unknown) => {
        console.error('[browser] could not start the pinned HTTPS proxy', error)
        throw new ToolError('The browser network guard could not start, so the page was not opened.')
      })
    }
    await this.proxyReady
  }

  private pageAddress(window: BrowserWindow): { url: string; title: string } {
    const rawUrl = window.webContents.getURL()
    if (!rawUrl || !this.allowedUrl(rawUrl)) throw new ToolError('The current page is no longer on an allowed HTTPS domain.')
    return {
      url: safeDisplayUrl(rawUrl),
      title: window.webContents.getTitle().slice(0, 240)
    }
  }

  private delay(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new ToolError('The browser action was cancelled.'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort)
        resolve()
      }, ms)
      const abort = (): void => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        reject(new ToolError('The browser action was cancelled.'))
      }
      signal.addEventListener('abort', abort, { once: true })
    })
  }
}
