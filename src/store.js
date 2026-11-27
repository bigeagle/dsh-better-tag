/**
 * Durable per-workspace tag records.
 *
 * One JSON document under `<DSH_HOME>/storages/better-tag/state.json`, written
 * atomically and serialized behind one promise chain, so a crash never leaves a
 * half-written file and two writes never interleave. The document is small
 * (one library per workspace, one record per tagged Session), and it never
 * enters a Session log.
 *
 * Every workspace owns its own tag library. A library materializes lazily the
 * first time its key is touched, seeded from the pre-0.2 global library when
 * one was migrated, so an upgraded deployment starts every workspace from the
 * vocabulary it already had. Session records stay global: a Session belongs to
 * one workspace at a time, and its `tagIds` always resolve inside the library
 * of the workspace the caller resolves for it.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/** Preset content palette for tag chips. */
export const PALETTE = [
  '#7c9cff', '#f0a35e', '#67c98a', '#c084fc',
  '#5ec8d8', '#6ea8fe', '#f07a7a', '#9aa0ad',
  '#b58cff', '#e0a3ff', '#ffb86b', '#8fd694',
]

/** Library key for Sessions that belong to no registered workspace. */
export const UNGROUPED = 'ungrouped'

const MAX_TAGS_PER_SESSION = 12
const MAX_TAGS_PER_LIBRARY = 200
const MAX_INLINE_TAGS = 8
const MAX_TAG_NAME = 16
const HEX = /^#[0-9a-fA-F]{6}$/

/** A validation or version failure the HTTP layer maps to a status. */
export class StoreError extends Error {
  constructor (code, message, status = 400) {
    super(message)
    this.name = 'StoreError'
    this.code = code
    this.status = status
  }
}

function emptyState () {
  return { version: 1, libraries: {}, sessions: {}, seed: null }
}

function clone (value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeName (raw) {
  const name = String(raw ?? '').trim()
  if (name.length < 1 || name.length > MAX_TAG_NAME) {
    throw new StoreError('bad-name', `tag name must be 1-${MAX_TAG_NAME} characters`)
  }
  return name
}

function parseColor (raw) {
  if (typeof raw === 'string' && HEX.test(raw)) return raw.toLowerCase()
  return null
}

function normalizeColor (raw) {
  return parseColor(raw) ?? PALETTE[0]
}

/**
 * Pick the palette color used least across the given tag records.
 *
 * A brand-new vocabulary has twelve equally unused colors, so the random
 * source picks freely; once colors repeat, the quiet ones win first. This is
 * still a fixed-palette choice — no arbitrary hues enter the store.
 *
 * @param {{ tags?: object[], extra?: object[], exclude?: string|null, rng?: Function }} options - color context and random source.
 * @returns one hex color from PALETTE.
 */
export function pickTagColor ({ tags = [], extra = [], exclude = null, rng = Math.random } = {}) {
  const counts = new Map()
  for (const tag of [...tags, ...extra]) {
    if (typeof tag?.color !== 'string') continue
    counts.set(tag.color, (counts.get(tag.color) ?? 0) + 1)
  }
  const scored = PALETTE
    .filter(color => color !== exclude)
    .map(color => ({ color, count: counts.get(color) ?? 0 }))
  if (scored.length === 0) return PALETTE[0]
  const least = Math.min(...scored.map(entry => entry.count))
  const pool = scored.filter(entry => entry.count === least).map(entry => entry.color)
  const index = Math.min(pool.length - 1, Math.floor(rng() * pool.length))
  return pool[index] ?? PALETTE[0]
}

function normalizeTag (record) {
  if (record === null || typeof record !== 'object') return null
  if (typeof record.id !== 'string' || typeof record.name !== 'string') return null
  return {
    id: record.id,
    name: record.name,
    color: typeof record.color === 'string' && HEX.test(record.color) ? record.color.toLowerCase() : PALETTE[0],
    order: Number.isInteger(record.order) ? record.order : 0,
    createdAt: Number.isFinite(record.createdAt) ? record.createdAt : Date.now(),
  }
}

function normalizeTags (value) {
  return Array.isArray(value) ? value.map(normalizeTag).filter(Boolean) : []
}

function normalizeLibrary (record) {
  return {
    tags: normalizeTags(record?.tags),
    agentTools: record?.agentTools === true,
  }
}

function normalizeInlineTags (value, nextColor) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const out = []
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue
    const name = String(item.name ?? '').trim()
    if (name.length < 1 || name.length > MAX_TAG_NAME) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const color = parseColor(item.color) ?? (typeof nextColor === 'function' ? nextColor(out) : PALETTE[0])
    out.push({ name, color })
    if (out.length >= MAX_INLINE_TAGS) break
  }
  return out
}

function normalizeSession (sessionId, record) {
  const tagIds = Array.isArray(record?.tagIds)
    ? [...new Set(record.tagIds.filter(id => typeof id === 'string'))].slice(0, MAX_TAGS_PER_SESSION)
    : []
  return {
    sessionId,
    tagIds,
    inlineTags: normalizeInlineTags(record?.inlineTags),
    done: record?.done === true,
    updatedAt: Number.isFinite(record?.updatedAt) ? record.updatedAt : Date.now(),
  }
}

/**
 * Build the store and start loading its document.
 * @param {{ dir: string, log?: Pick<Console, 'warn'>, rng?: () => number }} options - store location, logger, and random source.
 * @returns the store handle.
 */
export function createStore ({ dir, log = console, rng = Math.random }) {
  let data = emptyState()
  let chain = Promise.resolve()
  const file = path.join(dir, 'state.json')
  const changeListeners = new Set()

  async function load () {
    await fs.mkdir(dir, { recursive: true })
    try {
      const raw = await fs.readFile(file, 'utf8')
      const parsed = JSON.parse(raw)
      const sessions = {}
      if (parsed?.sessions !== null && typeof parsed.sessions === 'object') {
        for (const [id, record] of Object.entries(parsed.sessions)) {
          sessions[id] = normalizeSession(id, record)
        }
      }
      const libraries = {}
      if (parsed?.libraries !== null && typeof parsed.libraries === 'object') {
        for (const [key, record] of Object.entries(parsed.libraries)) {
          libraries[key] = normalizeLibrary(record)
        }
      }
      // A pre-0.2 document carries one global `tags` array and no `libraries`.
      // Keep it as the seed every new library starts from; seeded copies keep
      // their tag ids, so existing session tagIds keep resolving. A v2
      // document never writes `tags`, so its presence identifies the v1 form.
      const legacy = normalizeTags(parsed?.tags)
      data = {
        version: Number.isInteger(parsed?.version) && parsed.version > 0 ? parsed.version : 1,
        libraries,
        sessions,
        seed: Array.isArray(parsed?.seed) ? normalizeTags(parsed.seed) : (legacy.length > 0 ? legacy : null),
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') log.warn?.(`[better-tag] could not read ${file}: ${error.message}`)
    }
  }

  const ready = load()

  function persist () {
    const snapshot = JSON.stringify(data)
    const run = chain.then(async () => {
      await fs.mkdir(dir, { recursive: true })
      const tmp = `${file}.${process.pid}.tmp`
      await fs.writeFile(tmp, snapshot, 'utf8')
      await fs.rename(tmp, file)
    })
    chain = run.then(() => undefined, error => {
      log.warn?.(`[better-tag] could not write ${file}: ${error.message}`)
    })
    // In-memory state is already current at this point; observers read it
    // through state() rather than waiting for the disk write.
    for (const listener of [...changeListeners]) {
      try { listener() } catch { /* ignore */ }
    }
    return run
  }

  function state () {
    return clone({ version: data.version, libraries: data.libraries, sessions: data.sessions })
  }

  function checkVersion (ifVersion) {
    if (ifVersion === undefined || ifVersion === null) return
    if (!Number.isInteger(ifVersion) || ifVersion !== data.version) {
      throw new StoreError('version-conflict', `expected version ${data.version}`, 409)
    }
  }

  function libraryKeyOf (raw) {
    const key = String(raw ?? '').trim()
    return key === '' ? UNGROUPED : key
  }

  /** Materialize one library, seeded from the migrated global vocabulary. */
  function ensureLibrary (key) {
    if (data.libraries[key] === undefined) {
      data.libraries[key] = { tags: clone(data.seed ?? []), agentTools: false }
    }
    return data.libraries[key]
  }

  function tagById (library, id) {
    return library.tags.find(tag => tag.id === id)
  }

  function tagByName (library, name) {
    const needle = String(name ?? '').trim().toLowerCase()
    return library.tags.find(tag => tag.name.toLowerCase() === needle)
  }

  function touchSession (sessionId) {
    const current = data.sessions[sessionId]
    const next = normalizeSession(sessionId, current)
    next.updatedAt = Date.now()
    data.sessions[sessionId] = next
    return next
  }

  function newTag (library, name, color) {
    if (library.tags.length >= MAX_TAGS_PER_LIBRARY) {
      throw new StoreError('library-full', `a library holds at most ${MAX_TAGS_PER_LIBRARY} tags`)
    }
    return {
      id: randomUUID(),
      name,
      color: parseColor(color) ?? pickTagColor({ tags: library.tags, rng }),
      order: library.tags.length,
      createdAt: Date.now(),
    }
  }

  return {
    ready,
    state,

    /**
     * Observe committed mutations. The listener fires after in-memory state
     * is current (agent tool writes included), so UI snapshots never wait for
     * a page refresh.
     * @param {() => void} listener - change callback.
     * @returns a disposer removing the listener.
     */
    subscribe (listener) {
      changeListeners.add(listener)
      return () => { changeListeners.delete(listener) }
    },

    /** Materialize libraries for the given keys; persists only when one was created. */
    async ensureLibraries (keys) {
      await ready
      let changed = false
      for (const raw of keys ?? []) {
        const key = libraryKeyOf(raw)
        if (data.libraries[key] === undefined) {
          ensureLibrary(key)
          changed = true
        }
      }
      if (changed) await persist()
      return state()
    },

    /** Whether the model tag tools are enabled for one workspace library. */
    async agentToolsEnabled (libraryKey) {
      await ready
      return data.libraries[libraryKeyOf(libraryKey)]?.agentTools === true
    },

    /** Flip the per-workspace model-tools switch. */
    async setAgentTools ({ libraryKey, enabled } = {}) {
      await ready
      const library = ensureLibrary(libraryKeyOf(libraryKey))
      const next = enabled === true
      if (library.agentTools !== next) {
        library.agentTools = next
        data.version += 1
        await persist()
      }
      return state()
    },

    /** Update one Session's tags and/or done stamp; tagIds resolve inside its workspace library. */
    async setSession ({ sessionId, libraryKey, tagIds, inlineTags, done, ifVersion } = {}) {
      await ready
      if (typeof sessionId !== 'string' || sessionId === '') {
        throw new StoreError('bad-session', 'sessionId is required')
      }
      checkVersion(ifVersion)
      const record = touchSession(sessionId)
      if (Array.isArray(tagIds)) {
        const library = ensureLibrary(libraryKeyOf(libraryKey))
        record.tagIds = [...new Set(tagIds.filter(id => typeof id === 'string' && tagById(library, id)))]
          .slice(0, MAX_TAGS_PER_SESSION)
      }
      if (Array.isArray(inlineTags)) {
        record.inlineTags = normalizeInlineTags(inlineTags, parsed =>
          pickTagColor({ tags: data.libraries[libraryKeyOf(libraryKey)]?.tags ?? [], extra: parsed, rng }))
      }
      if (typeof done === 'boolean') record.done = done
      data.version += 1
      await persist()
      return state()
    },

    /** Create one tag in a workspace library; returns the new tag and the new state. */
    async createTag ({ libraryKey, name, color } = {}) {
      await ready
      const library = ensureLibrary(libraryKeyOf(libraryKey))
      const clean = normalizeName(name)
      if (tagByName(library, clean)) throw new StoreError('duplicate-name', `tag "${clean}" already exists`)
      const tag = newTag(library, clean, color)
      library.tags.push(tag)
      data.version += 1
      await persist()
      return { tag, state: state() }
    },

    /** Rename or recolor one tag; every Session keeps its reference by id. */
    async updateTag ({ libraryKey, id, name, color } = {}) {
      await ready
      const library = ensureLibrary(libraryKeyOf(libraryKey))
      const tag = tagById(library, id)
      if (!tag) throw new StoreError('missing-tag', 'tag not found', 404)
      if (name !== undefined) {
        const clean = normalizeName(name)
        const clash = tagByName(library, clean)
        if (clash && clash.id !== id) throw new StoreError('duplicate-name', `tag "${clean}" already exists`)
        tag.name = clean
      }
      if (color !== undefined) tag.color = normalizeColor(color)
      data.version += 1
      await persist()
      return state()
    },

    /** Delete one tag and every Session reference to it. */
    async deleteTag ({ libraryKey, id } = {}) {
      await ready
      const library = ensureLibrary(libraryKeyOf(libraryKey))
      if (!tagById(library, id)) throw new StoreError('missing-tag', 'tag not found', 404)
      library.tags = library.tags.filter(tag => tag.id !== id)
      for (const record of Object.values(data.sessions)) {
        record.tagIds = record.tagIds.filter(tagId => tagId !== id)
      }
      data.version += 1
      await persist()
      return state()
    },

    /**
     * Apply one batch of library edits (the model tool's write path).
     *
     * Operations apply in order create → rename → recolor → remove; every
     * name resolves case-insensitively against the library at that point.
     * Invalid operations are skipped and reported instead of failing the
     * batch, so one stale name never blocks the rest.
     *
     * @param {{ libraryKey: string, create?: object[], rename?: object[], recolor?: object[], remove?: string[] }} options - edit batches.
     * @returns the applied notes and the new state.
     */
    async editLibrary ({ libraryKey, create, rename, recolor, remove } = {}) {
      await ready
      const library = ensureLibrary(libraryKeyOf(libraryKey))
      const notes = []
      let changed = false
      for (const raw of Array.isArray(create) ? create : []) {
        let name
        try { name = normalizeName(raw?.name) } catch { notes.push(`create skipped: name must be 1-${MAX_TAG_NAME} characters`); continue }
        if (tagByName(library, name)) { notes.push(`create skipped: "${name}" already exists`); continue }
        try {
          library.tags.push(newTag(library, name, raw?.color))
          changed = true
        } catch (error) { notes.push(`create skipped: ${error.message}`) }
      }
      for (const raw of Array.isArray(rename) ? rename : []) {
        const tag = tagByName(library, String(raw?.from ?? ''))
        if (!tag) { notes.push(`rename skipped: no tag named "${String(raw?.from ?? '')}"`); continue }
        let name
        try { name = normalizeName(raw?.to) } catch { notes.push(`rename skipped: name must be 1-${MAX_TAG_NAME} characters`); continue }
        const clash = tagByName(library, name)
        if (clash && clash.id !== tag.id) { notes.push(`rename skipped: "${name}" already exists`); continue }
        tag.name = name
        changed = true
      }
      for (const raw of Array.isArray(recolor) ? recolor : []) {
        const tag = tagByName(library, String(raw?.name ?? ''))
        if (!tag) { notes.push(`recolor skipped: no tag named "${String(raw?.name ?? '')}"`); continue }
        if (parseColor(raw?.color) === null) { notes.push(`recolor skipped: "${tag.name}" needs a #rrggbb color`); continue }
        tag.color = parseColor(raw.color)
        changed = true
      }
      for (const raw of Array.isArray(remove) ? remove : []) {
        const tag = tagByName(library, String(raw ?? ''))
        if (!tag) { notes.push(`delete skipped: no tag named "${String(raw ?? '')}"`); continue }
        library.tags = library.tags.filter(candidate => candidate.id !== tag.id)
        for (const record of Object.values(data.sessions)) {
          record.tagIds = record.tagIds.filter(tagId => tagId !== tag.id)
        }
        changed = true
      }
      if (changed) {
        data.version += 1
        await persist()
      }
      return { notes, state: state() }
    },

    /**
     * Set one Session's library tags to exactly the given names, creating
     * names the library does not have yet. The model tool's assignment path.
     *
     * @param {{ sessionId: string, libraryKey: string, names: string[] }} options - target Session and tag names.
     * @returns the assigned tags and the new state.
     */
    async assignByNames ({ sessionId, libraryKey, names } = {}) {
      await ready
      if (typeof sessionId !== 'string' || sessionId === '') {
        throw new StoreError('bad-session', 'sessionId is required')
      }
      if (!Array.isArray(names)) throw new StoreError('bad-names', 'names must be an array')
      const library = ensureLibrary(libraryKeyOf(libraryKey))
      // Validate every name before mutating so a bad one fails the call
      // without leaving unversioned, unpersisted tags behind.
      const cleaned = []
      const seen = new Set()
      for (const raw of names) {
        const name = normalizeName(raw)
        const key = name.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        cleaned.push(name)
        if (cleaned.length >= MAX_TAGS_PER_SESSION) break
      }
      const assigned = []
      let created = false
      for (const name of cleaned) {
        let tag = tagByName(library, name)
        if (!tag) {
          tag = newTag(library, name, undefined)
          library.tags.push(tag)
          created = true
        }
        assigned.push(tag)
      }
      const record = touchSession(sessionId)
      record.tagIds = assigned.map(tag => tag.id)
      data.version += 1
      await persist()
      return { assigned: assigned.map(tag => ({ name: tag.name, color: tag.color })), created, state: state() }
    },

    /** Tag pack export: one workspace library's definitions, never Session assignments. */
    async exportPack (libraryKey) {
      await ready
      const library = ensureLibrary(libraryKeyOf(libraryKey))
      return {
        kind: 'dsh-better-tag-pack',
        version: 1,
        name: 'dsh-better-tag',
        tags: library.tags.map(tag => ({ name: tag.name, color: tag.color })),
      }
    },

    /** Merge an imported pack into one workspace library. */
    async importPack ({ libraryKey, pack } = {}) {
      await ready
      if (pack === null || typeof pack !== 'object' || !Array.isArray(pack.tags)) {
        throw new StoreError('bad-pack', 'pack.tags must be an array')
      }
      const library = ensureLibrary(libraryKeyOf(libraryKey))
      const report = { added: [], skipped: [], conflicts: [] }
      let changed = false
      for (const raw of pack.tags) {
        let name
        try { name = normalizeName(raw?.name) } catch { report.skipped.push(String(raw?.name ?? '')); continue }
        const incoming = parseColor(raw?.color)
        const existing = tagByName(library, name)
        if (!existing) {
          try {
            library.tags.push(newTag(library, name, incoming))
            report.added.push(name)
            changed = true
          } catch (error) {
            report.skipped.push(`${name} (${error.message})`)
          }
        } else if (incoming === null || existing.color === incoming) {
          report.skipped.push(name)
        } else {
          report.conflicts.push({ name, local: existing.color, incoming })
        }
      }
      if (changed) {
        data.version += 1
        await persist()
      }
      return { report, state: state() }
    },

    /** Clear the done stamp after the user sends a new message. */
    async clearDone (sessionId) {
      await ready
      const record = data.sessions[sessionId]
      if (!record || record.done !== true) return false
      record.done = false
      record.updatedAt = Date.now()
      data.version += 1
      await persist()
      return true
    },

    /** Copy a parent Session's tags onto a fork; the child never inherits done. */
    async copyTags (fromSessionId, toSessionId, libraryKey) {
      await ready
      if (typeof fromSessionId !== 'string' || typeof toSessionId !== 'string') return false
      if (fromSessionId === toSessionId) return false
      const parent = data.sessions[fromSessionId]
      if (!parent || (parent.tagIds.length === 0 && (parent.inlineTags?.length ?? 0) === 0)) return false
      const library = ensureLibrary(libraryKeyOf(libraryKey))
      const child = normalizeSession(toSessionId, data.sessions[toSessionId])
      child.tagIds = parent.tagIds.filter(id => tagById(library, id)).slice(0, MAX_TAGS_PER_SESSION)
      child.inlineTags = (parent.inlineTags ?? []).map(tag => ({ name: tag.name, color: tag.color }))
      child.done = false
      child.updatedAt = Date.now()
      data.sessions[toSessionId] = child
      data.version += 1
      await persist()
      return true
    },

    /**
     * Fork inheritance for a newly created Session.
     * @param session - the created Session object.
     * @param listLive - returns every live Session.
     * @param resolveKey - maps a sessionId to its workspace library key.
     */
    async inheritFork (session, listLive, resolveKey) {
      if (session?.header?.isSeeded !== true) return false
      const childId = String(session.id)
      if (session.header.origin === 'subagent') return false
      const key = typeof resolveKey === 'function' ? await resolveKey(childId) : UNGROUPED
      const direct = session.header.parentSession === undefined ? undefined : String(session.header.parentSession)
      if (direct !== undefined) return this.copyTags(direct, childId, key)
      const eventsOf = live => {
        if (typeof live?.snapshotEvents === 'function') return live.snapshotEvents()
        return Array.isArray(live?.events) ? live.events : []
      }
      const first = eventsOf(session)[0]
      if (first === undefined) return false
      let match
      let matchEvents = -1
      for (const other of listLive?.() ?? []) {
        if (String(other.id) === childId) continue
        const events = eventsOf(other)
        if (events[0] !== first) continue
        if (events.length > matchEvents) { match = other; matchEvents = events.length }
      }
      if (match === undefined) return false
      return this.copyTags(String(match.id), childId, key)
    },
  }
}
