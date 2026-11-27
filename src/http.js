/**
 * Same-origin API for the tag store.
 *
 * The Client half is a browser module without a Host RPC channel for this
 * package, so it talks to this prefix over same-origin `fetch`. The web
 * server's own authentication (the browser's session cookie) gates every
 * route; on top of that, every write must carry a custom header a cross-site
 * request cannot set without a preflight. Remote access through a trusted
 * proxy works exactly like loopback access.
 *
 * Tag libraries are per workspace. Routes that name a tag take either a
 * `workspaceKey` or a `sessionId`; a session resolves to its workspace's
 * library through the host-supplied `resolveKey`.
 */

const CSRF_HEADER = 'x-better-tag'
const MAX_BODY = 1024 * 1024
/** How long one /events long-poll holds before answering `changed: false`. */
const DEFAULT_EVENTS_HOLD_MS = 15000

/** One live registration per web server; a second apply reuses it. */
let active = null

function readJson (req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw.trim() === '') return resolve({})
      try { resolve(JSON.parse(raw)) } catch { reject(new Error('bad json')) }
    })
    req.on('error', reject)
  })
}

function send (res, status, json) {
  if (res.writableEnded) return
  const payload = Buffer.from(JSON.stringify(json), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.length),
    'cache-control': 'no-store',
  })
  res.end(payload)
}

/**
 * Register the tag API.
 * @param {{ webServer: { register: Function }, store: object, log?: object, path?: string,
 *   resolveKey?: (sessionId: string) => string|Promise<string>,
 *   workspaces?: () => Array<{ key: string, title: string, sessionIds?: string[] }>,
 *   onAgentTools?: (workspaceKey: string, enabled: boolean) => void,
 *   eventsHoldMs?: number }} options - dependencies.
 * @returns a disposer.
 */
export function registerLocalApi ({
  webServer,
  store,
  log = console,
  path: base = '/dsh-better-tag/v1',
  resolveKey = () => 'ungrouped',
  workspaces = () => [],
  onAgentTools = () => {},
  eventsHoldMs = DEFAULT_EVENTS_HOLD_MS,
} = {}) {
  if (webServer?.register === undefined) throw new Error('webServer is unavailable')
  if (active !== null && active.webServer === webServer && active.path === base) {
    active.store = store
    active.resolveKey = resolveKey
    active.workspaces = workspaces
    active.onAgentTools = onAgentTools
    active.holdMs = eventsHoldMs
    subscribeStore(active)
    return () => {
      if (active !== null && active.store === store) active.store = null
    }
  }

  /** Full client snapshot: libraries (ensured for live workspaces) plus the session→workspace map. */
  async function snapshot (live) {
    const known = live.workspaces() ?? []
    await live.store.ensureLibraries(known.map(entry => entry.key))
    const stateNow = live.store.state()
    const sessionWorkspaces = {}
    for (const entry of known) {
      for (const sessionId of entry.sessionIds ?? []) sessionWorkspaces[sessionId] = entry.key
    }
    return {
      ...stateNow,
      sessionWorkspaces,
      workspaces: known.map(entry => ({ key: entry.key, title: entry.title })),
    }
  }

  /** The library key one write targets: an explicit workspaceKey, else the session's workspace. */
  async function keyOf (live, body) {
    if (typeof body?.workspaceKey === 'string' && body.workspaceKey.trim() !== '') return body.workspaceKey
    if (typeof body?.sessionId === 'string' && body.sessionId !== '') return await live.resolveKey(body.sessionId)
    return 'ungrouped'
  }

  /* ------------------------------------------------------------------ */
  /* change push: long-polling, reliable through buffering proxies       */
  /* ------------------------------------------------------------------ */

  /**
   * Resolve once the store version passes `since` (immediately when it
   * already has), or false after `holdMs`. A completed response always
   * survives proxies that buffer streaming bodies, unlike SSE.
   */
  function waitForChange (registration, since, holdMs) {
    const current = registration.store?.state?.().version ?? 0
    if (current > since) return Promise.resolve(true)
    return new Promise(resolve => {
      const waiter = {
        since,
        timer: null,
        settle (changed) {
          clearTimeout(waiter.timer)
          registration.waiters.delete(waiter)
          resolve(changed)
        },
      }
      waiter.timer = setTimeout(() => waiter.settle(false), holdMs)
      waiter.timer.unref?.()
      registration.waiters.add(waiter)
    })
  }

  /** Wake every long-poll waiter whose baseline the store has passed. */
  function broadcast (registration) {
    const version = registration.store?.state?.().version ?? 0
    for (const waiter of [...registration.waiters]) {
      if (version > waiter.since) waiter.settle(true)
    }
  }

  function subscribeStore (registration) {
    try { registration.unsubscribe?.() } catch { /* ignore */ }
    registration.unsubscribe = typeof registration.store?.subscribe === 'function'
      ? registration.store.subscribe(() => broadcast(registration))
      : null
  }

  const registration = {
    webServer, path: base, store, resolveKey, workspaces, onAgentTools,
    waiters: new Set(), unsubscribe: null, holdMs: eventsHoldMs,
    dispose: null,
  }
  subscribeStore(registration)

  const dispose = webServer.register({
    kind: 'prefix',
    path: base,
    handler: async (req, res) => {
      try {
        if (req.method === 'POST' && req.headers[CSRF_HEADER] !== '1') {
          return send(res, 403, { ok: false, error: 'missing request header' })
        }
        const live = active ?? registration
        if (live.store === null || live.store === undefined) return send(res, 503, { ok: false, error: 'not-ready' })
        await live.store.ready
        const url = new URL(req.url ?? '/', 'http://local')
        const route = url.pathname.slice(base.length) || '/'

        if (req.method === 'GET' && (route === '/' || route === '/ping')) {
          return send(res, 200, { ok: true, service: 'better-tag' })
        }
        if (req.method === 'GET' && route === '/events') {
          const raw = Number(url.searchParams.get('since') ?? '-1')
          const since = Number.isFinite(raw) ? raw : -1
          const changed = await waitForChange(live, since, live.holdMs ?? eventsHoldMs)
          if (!changed) return send(res, 200, { ok: true, changed: false })
          return send(res, 200, { ok: true, changed: true, ...await snapshot(live) })
        }
        if (req.method === 'GET' && route === '/state') {
          return send(res, 200, { ok: true, ...await snapshot(live) })
        }
        if (req.method === 'GET' && route === '/export') {
          const key = url.searchParams.get('workspace') ?? await live.resolveKey(url.searchParams.get('session') ?? '')
          return send(res, 200, { ok: true, pack: await live.store.exportPack(key) })
        }
        if (req.method === 'POST' && route === '/session') {
          const body = await readJson(req)
          const state = await live.store.setSession({
            sessionId: body.sessionId,
            libraryKey: await keyOf(live, body),
            tagIds: body.tagIds,
            inlineTags: body.inlineTags,
            ifVersion: body.ifVersion,
          })
          return send(res, 200, { ok: true, ...state })
        }
        if (req.method === 'POST' && route === '/tags') {
          const body = await readJson(req)
          const result = await live.store.createTag({
            libraryKey: await keyOf(live, body),
            name: body.name,
            color: body.color,
          })
          return send(res, 200, { ok: true, tag: result.tag, ...result.state })
        }
        if (req.method === 'POST' && route === '/tags/update') {
          const body = await readJson(req)
          const state = await live.store.updateTag({
            libraryKey: await keyOf(live, body),
            id: body.id,
            name: body.name,
            color: body.color,
          })
          return send(res, 200, { ok: true, ...state })
        }
        if (req.method === 'POST' && route === '/tags/delete') {
          const body = await readJson(req)
          const state = await live.store.deleteTag({ libraryKey: await keyOf(live, body), id: body.id })
          return send(res, 200, { ok: true, ...state })
        }
        if (req.method === 'POST' && route === '/import') {
          const body = await readJson(req)
          const result = await live.store.importPack({ libraryKey: await keyOf(live, body), pack: body.pack })
          return send(res, 200, { ok: true, report: result.report, ...result.state })
        }
        if (req.method === 'POST' && route === '/agent-tools') {
          const body = await readJson(req)
          const key = await keyOf(live, body)
          const state = await live.store.setAgentTools({ libraryKey: key, enabled: body.enabled })
          try { live.onAgentTools(key, body.enabled === true) } catch (error) {
            log?.warn?.(`[better-tag] agent tools sync failed: ${error.message}`)
          }
          return send(res, 200, { ok: true, ...state })
        }
        return send(res, 404, { ok: false, error: 'not-found' })
      } catch (error) {
        const status = typeof error?.status === 'number' ? error.status : 500
        if (status >= 500) log?.warn?.(`[better-tag] ${error?.message ?? error}`)
        return send(res, status, { ok: false, error: error?.message ?? 'internal', code: error?.code ?? 'error' })
      }
    },
  })

  registration.dispose = dispose
  active = registration
  return () => {
    try { registration.unsubscribe?.() } catch { /* ignore */ }
    // Release held long-polls so unload never waits on open requests.
    for (const waiter of [...registration.waiters]) waiter.settle(false)
    try { dispose() } catch { /* ignore */ }
    if (active === registration) active = null
  }
}
