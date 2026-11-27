/**
 * Client half of dsh-better-tag.
 *
 * One module-level snapshot feeds every seat: sidebar row chips, the row
 * menu, the title-adjacent tag editor, and the overview panel.
 * Writes replace the snapshot with the response, and the Host's long-poll
 * change feed pushes every committed change (including agent tool writes) to
 * every open page, so all seats stay live without a manual refresh.
 */

window.__ModuleLoader__.load({
  id: 'dsh-better-tag',
  factory (require) {
    const React = require('react')
    const h = React.createElement
    const { useSyncExternalStore, useEffect, useRef, useState } = React

    const NS = 'better-tag'
    const PANEL_ID = 'better-tag-overview'
    // Resolve against the page base so a prefix-stripping proxy (a tunnel or
    // reverse proxy serving the GUI under /<prefix>/) keeps working: absolute
    // paths would escape the prefix. Mirrors how the shell resolves its own
    // same-origin routes against document.baseURI.
    const API = new URL('dsh-better-tag/v1', document.baseURI).href
    const HEADER = { 'x-better-tag': '1' }

    /** Must match PALETTE in src/store.js; the browser module cannot import it. */
    const PALETTE = [
      '#7c9cff', '#f0a35e', '#67c98a', '#c084fc',
      '#5ec8d8', '#6ea8fe', '#f07a7a', '#9aa0ad',
      '#b58cff', '#e0a3ff', '#ffb86b', '#8fd694',
    ]

    /** Below this tag count a filter costs more than it saves. */
    const SEARCH_THRESHOLD = 8

    const DICTS = {
      zh: {
        nav: '会话总览',
        panel: '会话总览',
        title: '会话总览',
        subtitle: '跨全部 workspace',
        pending: '待你',
        unread: 'AI 已交回',
        running: '进行中',
        idle: '空闲',
        showArchived: '显示归档',
        total: '共',
        export: '导出标签包',
        import: '导入标签包',
        manage: '管理标签',
        empty: '这个筛选下没有会话。',
        loadError: '标签服务未就绪',
        retry: '重试',
        picker: '标签',
        manageFromPicker: '管理标签…',
        searchOrCreate: '搜索或新建标签',
        searchPlaceholder: '搜索标签',
        noMatch: '没有匹配的标签',
        createNamed: '新建「{name}」',
        selectedCount: '已选 {n}',
        changeColor: '改颜色',
        randomColor: '随机',
        clearSearch: '清除搜索',
        tempSection: '临时标签 · 不入标签库',
        tempPlaceholder: '临时标签名',
        tempCreate: '临时',
        promote: '固定',
        remove: '移除',
        tempLimit: '每个会话最多 8 个临时标签',
        tempUsedLibrary: '已有同名标签，已改用标签库中的标签',
        promoteColorKept: '标签库已有同名标签，颜色沿用库中的',
        menuClearTemp: '清除临时标签',
        noTags: '还没有标签，先新建一个。',
        workspace: '工作区',
        settingsTitle: '设置',
        settingLimit: '侧栏标签数量',
        settingLimitHint: '会话行尾最多显示的标签数（0–5）；0 为不显示。悬停卡片与标题旁不受影响。',
        ungrouped: '未分组',
        agentTools: '允许 Agent 管理标签',
        agentToolsHint: '开启后，这个工作区的会话获得 session_tags_library_list/update 与 session_tags_get/set 四个工具',
        menuTags: '标签…',
        headerAdd: '标签',
        rename: '重命名',
        delete: '删除',
        deleteConfirm: '删除这个标签？它会从所有会话移除。',
        importTitle: '导入标签包',
        importHint: '粘贴 JSON 标签包，或选择文件。',
        importFile: '选择文件',
        importRun: '导入',
        importReport: '新增 {added} · 跳过 {skipped} · 冲突 {conflicts}',
        importReportTitle: '导入结果',
        close: '关闭',
        cancel: '取消',
        save: '保存',
        exporting: '正在导出…',
        importBad: '不是有效的标签包 JSON。',
      },
      en: {
        nav: 'Session overview',
        panel: 'Session overview',
        title: 'Session overview',
        subtitle: 'Across every workspace',
        pending: 'Needs you',
        unread: 'Handed back',
        running: 'Running',
        idle: 'Idle',
        showArchived: 'Show archived',
        total: 'Total',
        export: 'Export pack',
        import: 'Import pack',
        manage: 'Manage tags',
        empty: 'No sessions under this filter.',
        loadError: 'Tag service unavailable',
        retry: 'Retry',
        picker: 'Tags',
        manageFromPicker: 'Manage tags…',
        searchOrCreate: 'Search or create a tag',
        searchPlaceholder: 'Search tags',
        noMatch: 'No matching tags',
        createNamed: 'New "{name}"',
        selectedCount: '{n} selected',
        changeColor: 'Change color',
        randomColor: 'Random',
        clearSearch: 'Clear search',
        tempSection: 'Temporary · not in library',
        tempPlaceholder: 'Temporary tag name',
        tempCreate: 'Temp',
        promote: 'Pin',
        remove: 'Remove',
        tempLimit: 'Up to 8 temporary tags per session',
        tempUsedLibrary: 'A library tag with this name exists; used it instead',
        promoteColorKept: 'A library tag kept its own color',
        menuClearTemp: 'Clear temporary tags',
        noTags: 'No tags yet. Create one first.',
        workspace: 'Workspace',
        settingsTitle: 'Settings',
        settingLimit: 'Sidebar tag chips',
        settingLimitHint: 'Max tag chips on a session row (0-5); 0 hides them. The hover card and title area are unaffected.',
        ungrouped: 'Ungrouped',
        agentTools: 'Let the agent manage tags',
        agentToolsHint: 'When on, sessions in this workspace get the session_tags_library_list/update and session_tags_get/set tools',
        menuTags: 'Tags…',
        headerAdd: 'Tag',
        rename: 'Rename',
        delete: 'Delete',
        deleteConfirm: 'Delete this tag? It is removed from every session.',
        importTitle: 'Import tag pack',
        importHint: 'Paste a JSON tag pack, or choose a file.',
        importFile: 'Choose file',
        importRun: 'Import',
        importReport: 'Added {added} · skipped {skipped} · conflicts {conflicts}',
        importReportTitle: 'Import result',
        close: 'Close',
        cancel: 'Cancel',
        save: 'Save',
        exporting: 'Exporting…',
        importBad: 'Not a valid tag-pack JSON.',
      },
    }

    let translate = key => DICTS.zh[key] ?? key
    const t = (key, vars) => {
      const text = String(translate(key) ?? key)
      if (vars === undefined || vars === null) return text
      return text.replace(/\{(\w+)\}/g, (_m, name) => String(vars[name] ?? `{${name}}`))
    }

    /* ------------------------------------------------------------------ */
    /* store                                                               */
    /* ------------------------------------------------------------------ */

    let view = {
      version: 0, libraries: {}, sessions: {}, sessionWorkspaces: {}, workspaces: [],
      settings: {}, phase: 'loading', error: null, notice: null,
    }
    let snapshot = view
    const listeners = new Set()

    function commit (patch) {
      view = { ...view, ...patch, phase: patch.phase ?? (view.phase === 'loading' ? 'ready' : view.phase) }
      snapshot = view
      for (const listener of [...listeners]) {
        try { listener() } catch { /* ignore */ }
      }
    }
    const subscribe = listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }
    const useStore = () => useSyncExternalStore(subscribe, () => snapshot, () => snapshot)

    let noticeTimer = null
    function notify (message) {
      commit({ notice: message })
      if (noticeTimer !== null) clearTimeout(noticeTimer)
      noticeTimer = setTimeout(() => { noticeTimer = null; commit({ notice: null }) }, 4000)
    }

    async function api (pathname, body) {
      const response = await fetch(API + pathname, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined
          ? { accept: 'application/json' }
          : { accept: 'application/json', 'content-type': 'application/json', ...HEADER },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      let json
      try { json = await response.json() } catch { json = null }
      if (!response.ok || json === null || json.ok === false) {
        const error = new Error(json?.error ?? `request failed (${response.status})`)
        error.status = response.status
        error.code = json?.code
        throw error
      }
      return json
    }

    function applyState (json) {
      // Snapshots arrive from write responses, /state, and the SSE stream in
      // no guaranteed order; the store version only moves forward, so a late
      // older frame must not roll the view back.
      if (typeof json?.version === 'number' && json.version < view.version) return
      // Write responses carry {version, libraries, sessions}; only /state and
      // SSE frames add the session→workspace map and the workspace list, so
      // keep the previous maps when a response omits them.
      commit({
        version: json.version,
        libraries: json.libraries ?? view.libraries,
        sessions: json.sessions ?? view.sessions,
        sessionWorkspaces: json.sessionWorkspaces ?? view.sessionWorkspaces,
        workspaces: json.workspaces ?? view.workspaces,
        settings: json.settings ?? view.settings,
        phase: 'ready',
        error: null,
      })
    }

    /**
     * Follow the Host's change feed by long-polling `/events?since=<version>`:
     * the Host holds the request until the store moves past our version, then
     * answers with the full snapshot. A completed response survives proxies
     * that buffer streaming bodies (where EventSource stalls), and errors
     * back off briefly before re-polling.
     * @returns a disposer stopping the loop.
     */
    function startEvents () {
      let stopped = false
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
      const loop = async () => {
        while (!stopped) {
          try {
            const response = await fetch(API + '/events?since=' + view.version, {
              headers: { accept: 'application/json' },
            })
            if (stopped) return
            if (response.ok) {
              const json = await response.json()
              if (json?.changed === true) applyState(json)
              continue
            }
            await pause(3000)
          } catch {
            if (!stopped) await pause(3000)
          }
        }
      }
      void loop()
      return () => { stopped = true }
    }

    async function refresh () {
      try {
        applyState(await api('/state'))
      } catch (error) {
        commit({ phase: 'error', error: error.message })
      }
    }

    async function saveSession (sessionId, patch) {
      try {
        applyState(await api('/session', { sessionId, ifVersion: view.version, ...patch }))
        return true
      } catch (error) {
        if (error.status === 409) {
          await refresh()
          try {
            applyState(await api('/session', { sessionId, ifVersion: view.version, ...patch }))
            return true
          } catch (retry) {
            notify(retry.message)
            return false
          }
        }
        notify(error.message)
        return false
      }
    }

    const setTags = (sessionId, tagIds) => saveSession(sessionId, { tagIds })

    async function toggleTag (sessionId, tagId) {
      const current = view.sessions[sessionId]?.tagIds ?? []
      const next = current.includes(tagId) ? current.filter(id => id !== tagId) : [...current, tagId]
      return setTags(sessionId, next)
    }

    /**
     * The library one session draws from: the tags of the workspace accounting
     * it, or the shared ungrouped bucket. A session missing from the map is
     * newer than the last /state fetch; writes still resolve correctly on the
     * host, and opening the picker refreshes the map.
     */
    function libraryKeyOf (sessionId) {
      return view.sessionWorkspaces[sessionId] ?? 'ungrouped'
    }

    function libraryOf (sessionId) {
      return view.libraries[libraryKeyOf(sessionId)]?.tags ?? []
    }

    /** Create one library tag; scope is {sessionId} or {workspaceKey}. */
    async function createTag (scope, name, color) {
      try {
        const json = await api('/tags', color === undefined ? { ...scope, name } : { ...scope, name, color })
        applyState(json)
        return json.tag
      } catch (error) {
        notify(error.message)
        return null
      }
    }

    async function updateTag (scope, id, patch) {
      try {
        applyState(await api('/tags/update', { ...scope, id, ...patch }))
      } catch (error) { notify(error.message) }
    }

    async function deleteTag (scope, id) {
      try {
        applyState(await api('/tags/delete', { ...scope, id }))
      } catch (error) { notify(error.message) }
    }

    async function setAgentTools (workspaceKey, enabled) {
      try {
        applyState(await api('/agent-tools', { workspaceKey, enabled }))
      } catch (error) { notify(error.message) }
    }

    async function setInlineTags (sessionId, inlineTags) {
      return saveSession(sessionId, { inlineTags })
    }

    async function addInlineTag (sessionId, raw) {
      const name = String(raw ?? '').trim()
      if (name.length < 1) return false
      if (name.length > 16) { notify(t('tempLimit')); return false }
      const library = libraryOf(sessionId).find(tag => tag.name.toLowerCase() === name.toLowerCase())
      if (library !== undefined) {
        const current = view.sessions[sessionId]?.tagIds ?? []
        if (!current.includes(library.id)) await setTags(sessionId, [...current, library.id])
        notify(t('tempUsedLibrary'))
        return true
      }
      const current = inlineTagsOf(sessionId)
      if (current.some(tag => tag.name.toLowerCase() === name.toLowerCase())) return true
      if (current.length >= 8) { notify(t('tempLimit')); return false }
      return saveSession(sessionId, { inlineTags: [...current, { name, color: chooseColor(libraryOf(sessionId), current) }] })
    }

    async function removeInlineTag (sessionId, name) {
      return saveSession(sessionId, { inlineTags: inlineTagsOf(sessionId).filter(tag => tag.name !== name) })
    }

    async function promoteInlineTag (sessionId, name) {
      const inline = inlineTagsOf(sessionId).find(tag => tag.name === name)
      if (inline === undefined) return false
      let tagId
      const existing = libraryOf(sessionId).find(tag => tag.name.toLowerCase() === name.toLowerCase())
      if (existing !== undefined) {
        tagId = existing.id
        if (existing.color !== inline.color) notify(t('promoteColorKept'))
      } else {
        const created = await createTag({ sessionId }, name, inline.color)
        if (created === null) return false
        tagId = created.id
      }
      const current = view.sessions[sessionId]?.tagIds ?? []
      const tagIds = current.includes(tagId) ? current : [...current, tagId]
      const inlineTags = inlineTagsOf(sessionId).filter(tag => tag.name !== name)
      return saveSession(sessionId, { tagIds, inlineTags })
    }

    async function exportPack (workspaceKey) {
      try {
        const json = await api('/export?workspace=' + encodeURIComponent(workspaceKey))
        const blob = new Blob([JSON.stringify(json.pack, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = 'dsh-better-tag-pack.json'
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      } catch (error) { notify(error.message) }
    }

    async function importPack (workspaceKey, pack) {
      try {
        const json = await api('/import', { workspaceKey, pack })
        applyState(json)
        return json.report
      } catch (error) {
        notify(error.message)
        return null
      }
    }

    function sessionTags (sessionId) {
      const meta = view.sessions[sessionId]
      if (meta === undefined) return []
      const library = libraryOf(sessionId)
      const tags = meta.tagIds
        .map(id => library.find(tag => tag.id === id))
        .filter(Boolean)
        .map(tag => ({ ...tag, key: tag.id, ephemeral: false }))
      const inline = (meta.inlineTags ?? []).map(tag => ({
        key: `inline:${tag.name}`, name: tag.name, color: tag.color, ephemeral: true,
      }))
      return [...tags, ...inline]
    }

    function inlineTagsOf (sessionId) {
      return view.sessions[sessionId]?.inlineTags ?? []
    }

    /**
     * Pick the palette color used least by the given library plus the given
     * extra tags. Mirrors pickTagColor in src/store.js so temp tags and
     * library tags spread over the palette the same way.
     */
    function chooseColor (baseTags, extra = [], exclude = null) {
      const counts = new Map()
      for (const tag of [...baseTags, ...extra]) {
        if (typeof tag?.color !== 'string') continue
        counts.set(tag.color, (counts.get(tag.color) ?? 0) + 1)
      }
      const scored = PALETTE
        .filter(color => color !== exclude)
        .map(color => ({ color, count: counts.get(color) ?? 0 }))
      if (scored.length === 0) return PALETTE[0]
      const least = Math.min(...scored.map(entry => entry.count))
      const pool = scored.filter(entry => entry.count === least).map(entry => entry.color)
      return pool[Math.floor(Math.random() * pool.length)] ?? PALETTE[0]
    }

    /* ------------------------------------------------------------------ */
    /* picker + panel UI state                                             */
    /* ------------------------------------------------------------------ */

    let overlay = { open: false, sessionId: null, rect: null }
    let overlaySnapshot = overlay
    const overlayListeners = new Set()
    function commitOverlay (next) {
      overlay = { ...overlay, ...next }
      overlaySnapshot = overlay
      for (const listener of [...overlayListeners]) {
        try { listener() } catch { /* ignore */ }
      }
    }
    const subscribeOverlay = listener => {
      overlayListeners.add(listener)
      return () => { overlayListeners.delete(listener) }
    }
    const useOverlay = () => useSyncExternalStore(subscribeOverlay, () => overlaySnapshot, () => overlaySnapshot)

    /** Collapsed overview sections survive page reloads; tag filters are per-visit. */
    const COLLAPSE_KEY = 'dsh-better-tag.overview-collapsed.v1'
    function loadCollapsed () {
      try {
        const parsed = JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '{}')
        return parsed !== null && typeof parsed === 'object' ? parsed : {}
      } catch { return {} }
    }

    let ui = { manager: false, importOpen: false, settingsOpen: false, managerQuery: '', managerKey: null, collapsed: loadCollapsed(), tagFilters: {} }
    let uiSnapshot = ui
    const uiListeners = new Set()
    function commitUi (next) {
      ui = { ...ui, ...next }
      uiSnapshot = ui
      for (const listener of [...uiListeners]) {
        try { listener() } catch { /* ignore */ }
      }
    }
    const subscribeUi = listener => {
      uiListeners.add(listener)
      return () => { uiListeners.delete(listener) }
    }
    const useUi = () => useSyncExternalStore(subscribeUi, () => uiSnapshot, () => uiSnapshot)

    function openPicker (sessionId, rect) {
      commitOverlay({ open: true, sessionId, rect })
      // A session newer than the last /state fetch has no workspace mapping
      // yet; refresh so the picker shows its workspace's library.
      void refresh()
    }

    function toggleCollapsed (key) {
      const next = { ...ui.collapsed }
      if (next[key] === true) delete next[key]
      else next[key] = true
      try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      commitUi({ collapsed: next })
    }

    /** Select (or clear, with null) one workspace section's tag filter. */
    function setTagFilter (key, tagId) {
      const next = { ...ui.tagFilters }
      if (tagId === null) delete next[key]
      else next[key] = tagId
      commitUi({ tagFilters: next })
    }
    function closePicker () {
      commitOverlay({ open: false })
    }

    /* ------------------------------------------------------------------ */
    /* icons                                                               */
    /* ------------------------------------------------------------------ */

    function CheckIcon ({ size = 12 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true },
        h('path', {
          d: 'M3 8.6 6.4 12 13 4.6',
          fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
        }))
    }

    function TagIcon ({ size = 14 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true },
        h('path', {
          d: 'M2.5 6.2c0-.7.6-1.2 1.2-1.2h4.1c.3 0 .6.1.8.3l4.6 4.6c.5.5.5 1.2 0 1.7l-3.7 3.7c-.5.5-1.2.5-1.7 0L3.2 10.7a1.2 1.2 0 0 1-.3-.8z',
          fill: 'currentColor',
        }),
        h('circle', { cx: 6.1, cy: 7.8, r: 1.1, fill: 'var(--bt-icon-cut, #1b1d24)' }))
    }

    function ChevronIcon ({ size = 10 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true },
        h('path', {
          d: 'M4 6.2 8 10.2 12 6.2',
          fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
        }))
    }

    /* ------------------------------------------------------------------ */
    /* shared bits                                                         */
    /* ------------------------------------------------------------------ */

    function Chip ({ tag, onClick, title }) {
      const style = {
        '--bt-chip': tag.color,
        background: `color-mix(in srgb, ${tag.color} 16%, transparent)`,
        borderColor: `color-mix(in srgb, ${tag.color} 36%, transparent)`,
        color: tag.color,
      }
      const className = 'bt-chip' + (tag.ephemeral === true ? ' is-temp' : '') + (onClick === undefined ? '' : ' bt-chip-button')
      if (onClick === undefined) {
        return h('span', { className, style, title: title ?? tag.name }, tag.name)
      }
      return h('button', { type: 'button', className, style, title: title ?? tag.name, onClick }, tag.name)
    }

    /**
     * One tag's color dot plus its inline palette. The dot stays visible so a
     * recolor is one click away wherever the tag is listed; the palette is
     * inline (not absolutely positioned) so a scrolling list never clips it.
     * `base` is the library the tag belongs to, so "random" spreads colors
     * within that library.
     */
    function ColorControl ({ tag, base = [], onPick }) {
      const [open, setOpen] = useState(false)
      const wrapRef = useRef(null)
      useEffect(() => {
        if (!open) return undefined
        const onDown = event => {
          if (wrapRef.current !== null && !wrapRef.current.contains(event.target)) setOpen(false)
        }
        document.addEventListener('mousedown', onDown)
        return () => document.removeEventListener('mousedown', onDown)
      }, [open])
      return h('span', { className: 'bt-color-wrap', ref: wrapRef },
        h('button', {
          type: 'button',
          className: 'bt-color-dot' + (open ? ' is-open' : ''),
          style: { background: tag.color },
          title: `${t('changeColor')} · ${tag.name}`,
          'aria-label': `${t('changeColor')} · ${tag.name}`,
          'aria-expanded': open,
          onClick: () => setOpen(value => !value),
        }),
        open
          ? h('div', { className: 'bt-color-pop' },
            PALETTE.map(color => h('button', {
              key: color, type: 'button',
              className: 'bt-color-swatch' + (tag.color === color ? ' is-on' : ''),
              style: { background: color },
              title: color,
              'aria-label': color,
              onClick: () => onPick(color),
            })),
            h('button', {
              type: 'button', className: 'bt-color-random',
              title: t('randomColor'),
              onClick: () => onPick(chooseColor(base, [], tag.color)),
            }, t('randomColor')))
          : null)
    }

    function useSessionMeta (sessionId) {
      const snap = useStore()
      return { meta: snap.sessions[sessionId], tags: sessionTags(sessionId), snap }
    }

    /* ------------------------------------------------------------------ */
    /* sidebar row decorations                                             */
    /* ------------------------------------------------------------------ */

    function RowTags ({ sessionId }) {
      const { tags, snap } = useSessionMeta(sessionId)
      // The row is the title's space first: the settings page caps how many
      // chips show here (0 hides them); the hover card always lists all.
      const limit = snap.settings?.sidebarTagLimit ?? 2
      if (limit <= 0 || tags.length === 0) return null
      const shown = tags.slice(0, limit)
      return h('span', { className: 'bt-row-tags' },
        shown.map(tag => h(Chip, { key: tag.key, tag })),
        tags.length > limit ? h('span', { className: 'bt-more' }, `+${tags.length - limit}`) : null)
    }

    /* ------------------------------------------------------------------ */
    /* session row menu                                                    */
    /* ------------------------------------------------------------------ */

    function MenuTagsItem ({ sessionId, useMenuOpenState }) {
      const [, setMenuOpen] = useMenuOpenState()
      const { tags } = useSessionMeta(sessionId)
      return h('button', {
        type: 'button', role: 'menuitem', className: 'bt-menuitem',
        onClick: event => {
          setMenuOpen(false)
          openPicker(sessionId, event.currentTarget.getBoundingClientRect())
        },
      }, h(TagIcon, { size: 14 }), t('menuTags'), tags.length > 0 ? h('span', { className: 'bt-menu-count' }, String(tags.length)) : null)
    }

    /* ------------------------------------------------------------------ */
    /* session hover card                                                  */
    /* ------------------------------------------------------------------ */

    function HoverTags ({ sessionId }) {
      const { tags } = useSessionMeta(sessionId)
      if (tags.length === 0) return null
      return h('div', { className: 'bt-hover' },
        h('div', { className: 'bt-hover-head' }, t('picker')),
        h('div', { className: 'bt-hover-chips' },
          tags.map(tag => h(Chip, { key: tag.key, tag }))))
    }

    /* ------------------------------------------------------------------ */
    /* title-adjacent tags                                                 */
    /* ------------------------------------------------------------------ */

    function HeaderTags ({ sessionId }) {
      const { tags } = useSessionMeta(sessionId)
      const shown = tags.slice(0, 3)
      return h('span', { className: 'bt-head-tags' },
        shown.map(tag => h(Chip, {
          key: tag.key, tag, title: t('picker'),
          onClick: event => openPicker(sessionId, event.currentTarget.getBoundingClientRect()),
        })),
        tags.length > 3 ? h('span', { className: 'bt-more' }, `+${tags.length - 3}`) : null,
        h('button', {
          type: 'button', className: 'bt-add-tag',
          onClick: event => openPicker(sessionId, event.currentTarget.getBoundingClientRect()),
          title: t('headerAdd'),
        }, '+ ' + t('headerAdd')))
    }

    /* ------------------------------------------------------------------ */
    /* tag picker overlay                                                  */
    /* ------------------------------------------------------------------ */

    function PickerOverlay () {
      const current = useOverlay()
      const snap = useStore()
      const [tempDraft, setTempDraft] = useState('')
      const [query, setQuery] = useState('')
      const notice = snap.notice
      useEffect(() => {
        if (current.open) setQuery('')
      }, [current.open, current.sessionId])
      if (!current.open || current.sessionId === null) {
        return notice === null || notice === undefined
          ? null
          : h('div', { className: 'bt-toast' }, notice)
      }
      const sessionId = current.sessionId
      const meta = snap.sessions[sessionId]
      const library = libraryOf(sessionId)
      const selected = new Set(meta?.tagIds ?? [])
      const inline = inlineTagsOf(sessionId)
      const queryName = query.trim()
      const needle = queryName.toLowerCase()
      const exactMatch = queryName !== '' && library.some(tag => tag.name.toLowerCase() === needle)
      const canCreate = queryName !== '' && queryName.length <= 16 && !exactMatch
      const matching = needle === ''
        ? library
        : library.filter(tag => tag.name.toLowerCase().includes(needle))
      const rect = current.rect
      const width = 264
      const left = Math.max(8, Math.min(rect?.left ?? 16, window.innerWidth - width - 8))
      // Keep the anchor stable while the search filters rows: the panel grows
      // downward and scrolls instead of moving out from under the pointer.
      const anchorTop = (rect?.bottom ?? 64) + 6
      const top = window.innerHeight - anchorTop - 8 >= 240
        ? anchorTop
        : Math.max(8, window.innerHeight - 470 - 8)
      const maxHeight = Math.max(240, Math.min(470, window.innerHeight - top - 8))

      const createFromQuery = async () => {
        const name = queryName
        if (name === '' || name.length > 16) return
        const tag = await createTag({ sessionId }, name, chooseColor(library))
        if (tag === null) return
        setQuery('')
        await toggleTag(sessionId, tag.id)
      }

      const onSearchKeyDown = event => {
        const composing = event.nativeEvent?.isComposing === true || event.nativeEvent?.keyCode === 229
        if (event.key === 'Escape') {
          if (composing) return
          if (query !== '') { setQuery(''); return }
          closePicker()
          return
        }
        if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
        event.preventDefault()
        if (composing || event.nativeEvent?.repeat === true) return
        if (queryName === '') return
        if (matching.length > 0) {
          const first = matching[0]
          if (!selected.has(first.id)) void toggleTag(sessionId, first.id)
          setQuery('')
          return
        }
        if (canCreate) void createFromQuery()
      }

      const head = h('div', { className: 'bt-picker-head' },
        h('span', null, t('picker')),
        h('span', { className: 'bt-picker-head-count' }, t('selectedCount', { n: selected.size })))
      const search = h('div', { className: 'bt-search-row' },
        h('input', {
          className: 'bt-input bt-search', value: query, placeholder: t('searchOrCreate'),
          maxLength: 16,
          autoFocus: true,
          'aria-label': t('searchOrCreate'),
          onChange: event => setQuery(event.target.value),
          onKeyDown: onSearchKeyDown,
        }),
        query === ''
          ? null
          : h('button', {
            type: 'button', className: 'bt-search-clear',
            title: t('clearSearch'), 'aria-label': t('clearSearch'),
            onClick: () => setQuery(''),
          }, '×'))
      const empty = library.length === 0
        ? h('div', { className: 'bt-picker-empty' }, t('noTags'))
        : (needle !== '' && matching.length === 0
            ? h('div', { className: 'bt-picker-empty' }, t('noMatch'))
            : null)
      const createQuery = canCreate
        ? h('button', {
          type: 'button', className: 'bt-picker-create-query',
          onClick: () => { void createFromQuery() },
        }, '+ ' + t('createNamed', { name: queryName }))
        : null
      const rows = matching.map(tag => h('div', {
        key: tag.id,
        className: 'bt-pick-row' + (selected.has(tag.id) ? ' is-on' : ''),
      },
      h('button', {
        type: 'button', className: 'bt-pick-main',
        onClick: () => { void toggleTag(sessionId, tag.id) },
      },
      h('span', { className: 'bt-swatch', style: { background: tag.color } }),
      h('span', { className: 'bt-pick-name' }, tag.name),
      selected.has(tag.id) ? h('span', { className: 'bt-pick-check' }, h(CheckIcon, { size: 11 })) : null),
      h(ColorControl, { tag, base: library, onPick: color => { void updateTag({ sessionId }, tag.id, { color }) } })))
      const list = h('div', { className: 'bt-picker-list' }, rows)
      const manage = h('button', {
        type: 'button', className: 'bt-link',
        onClick: () => {
          closePicker()
          commitUi({ manager: true, managerQuery: query.trim(), managerKey: libraryKeyOf(sessionId) })
          selectPanel(PANEL_ID)
        },
      }, t('manageFromPicker'))
      const tempSection = h('div', { className: 'bt-picker-sect' }, t('tempSection'))
      const tempRows = inline.map(tag => h('div', { key: `inline:${tag.name}`, className: 'bt-temp-row' },
        h('span', { className: 'bt-swatch is-temp', style: { borderColor: tag.color } }),
        h('span', { className: 'bt-pick-name' }, tag.name),
        h('button', {
          type: 'button', className: 'bt-temp-action',
          onClick: () => { void promoteInlineTag(sessionId, tag.name) },
        }, t('promote')),
        h('button', {
          type: 'button', className: 'bt-temp-action',
          onClick: () => { void removeInlineTag(sessionId, tag.name) },
        }, t('remove'))))
      const tempList = h('div', { className: 'bt-temp-list' }, tempRows)
      const tempNew = h('div', { className: 'bt-picker-new' },
        h('input', {
          className: 'bt-input', value: tempDraft, placeholder: t('tempPlaceholder'), maxLength: 16,
          onChange: event => setTempDraft(event.target.value),
          onKeyDown: event => {
            if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
            event.preventDefault()
            if (event.nativeEvent?.isComposing === true || event.nativeEvent?.keyCode === 229 || event.nativeEvent?.repeat === true) return
            void addInlineTag(sessionId, tempDraft).then(() => setTempDraft(''))
          },
        }),
        h('button', {
          type: 'button', className: 'bt-btn',
          onClick: () => { void addInlineTag(sessionId, tempDraft).then(() => setTempDraft('')) },
        }, t('tempCreate')))
      const picker = h('div', {
        className: 'bt-picker',
        style: { left, top, width, maxHeight },
      }, head, search, empty, list, createQuery, tempSection, tempList, tempNew, manage)
      const overlayElement = h('div', {
        className: 'bt-overlay',
        onMouseDown: event => { if (event.target === event.currentTarget) closePicker() },
      }, picker)
      const toast = notice === null || notice === undefined ? null : h('div', { className: 'bt-toast' }, notice)
      return toast === null ? overlayElement : h(React.Fragment, null, toast, overlayElement)
    }

    /* ------------------------------------------------------------------ */
    /* overview panel                                                      */
    /* ------------------------------------------------------------------ */

    function statusOf (sessionId, statuses, sessions) {
      const state = statuses?.get?.(sessionId)
      if (state?.pendingInteraction != null) return 'pending'
      if (state?.completionUnread === true) return 'unread'
      if (state?.running === true) return 'running'
      return 'idle'
    }

    const RANK = { pending: 0, unread: 1, running: 2, idle: 3 }

    function OverviewPanel (props) {
      const ids = props.useSessions(state => state.ids)
      const byId = props.useSessions(state => state.byId)
      const archivedIds = props.useWorkspaces(state => state.archivedSessionIds)
      const statuses = props.useSessionStatus(map => map)
      const snap = useStore()
      const currentUi = useUi()
      const [showArchived, setShowArchived] = useState(false)
      const [importText, setImportText] = useState('')
      const [report, setReport] = useState(null)
      const fileRef = useRef(null)

      // Sessions or workspaces created after the last /state fetch group
      // under the wrong section until a refresh lands.
      useEffect(() => { void refresh() }, [])

      const archived = new Set(archivedIds ?? [])
      const collapsed = currentUi.collapsed ?? {}
      const tagFilters = currentUi.tagFilters ?? {}

      const all = []
      for (const id of ids ?? []) {
        const summary = byId?.[id]
        if (summary === undefined || summary.blank === true) continue
        all.push(summary)
      }
      const visible = all
        .filter(summary => showArchived || !archived.has(summary.id))
        .map(summary => ({ summary, status: statusOf(summary.id, statuses, snap.sessions) }))
        .sort((a, b) => (RANK[a.status] - RANK[b.status]) || ((b.summary.updatedAt ?? 0) - (a.summary.updatedAt ?? 0)))

      const counts = { pending: 0, unread: 0, running: 0 }
      for (const summary of all) {
        if (archived.has(summary.id) && !showArchived) continue
        const status = statusOf(summary.id, statuses, snap.sessions)
        if (counts[status] !== undefined) counts[status] += 1
      }

      // Group by the session's tag library (its workspace), mirroring the
      // per-workspace libraries. A group inherits its most urgent session's
      // rank, so a workspace with something waiting still floats to the top;
      // rows keep the flat list's status-then-recency order inside a group.
      // Each section carries its own tag filter over that workspace's library;
      // group ordering reads unfiltered rows so filtering never reorders the page.
      const grouped = new Map()
      for (const row of visible) {
        const key = libraryKeyOf(row.summary.id)
        if (!grouped.has(key)) grouped.set(key, [])
        grouped.get(key).push(row)
      }
      const wsTitles = new Map((snap.workspaces ?? []).map(entry => [entry.key, entry.title]))
      const sections = [...grouped.entries()].map(([key, rows]) => {
        const tags = snap.libraries[key]?.tags ?? []
        const raw = tagFilters[key] ?? null
        // A filter naming a since-deleted tag reads as no filter.
        const filterId = raw !== null && tags.some(tag => tag.id === raw) ? raw : null
        const shown = filterId === null
          ? rows
          : rows.filter(row => (snap.sessions[row.summary.id]?.tagIds ?? []).includes(filterId))
        return {
          key,
          title: wsTitles.get(key) ?? (key === 'ungrouped' ? t('ungrouped') : key),
          rows,
          shown,
          tags,
          filterId,
          rank: Math.min(...rows.map(row => RANK[row.status])),
          latest: Math.max(...rows.map(row => row.summary.updatedAt ?? 0)),
        }
      }).sort((a, b) => (a.rank - b.rank) || (b.latest - a.latest))

      const openSession = sessionId => {
        try { openSessionById(sessionId) } catch { /* ignore */ }
        selectPanel(null)
      }

      const doImport = async () => {
        let pack
        try {
          pack = JSON.parse(importText)
        } catch {
          notify(t('importBad'))
          return
        }
        const result = await importPack(currentUi.managerKey ?? 'ungrouped', pack)
        if (result !== null) {
          setReport(result)
          setImportText('')
          commitUi({ importOpen: false })
        }
      }

      const pickFile = async file => {
        if (!file) return
        try { setImportText(await file.text()) } catch { /* ignore */ }
      }

      return h('div', { className: 'bt-panel' },
        h('div', { className: 'bt-panel-head' },
          h('div', null,
            h('h2', { className: 'bt-panel-title' }, t('title')),
            h('div', { className: 'bt-panel-sub' }, t('subtitle'))),
          h('div', { className: 'bt-toolbar' },
            tagLimitForm === null ? null : h('button', {
              type: 'button', className: 'bt-btn bt-icon-btn',
              title: t('settingsTitle'), 'aria-label': t('settingsTitle'),
              onClick: () => commitUi({ settingsOpen: true }),
            }, h(GearIcon, { size: 14 })),
            h('button', {
              type: 'button', className: 'bt-btn',
              onClick: () => { commitUi({ manager: true, managerQuery: '', managerKey: sections[0]?.key ?? snap.workspaces?.[0]?.key ?? 'ungrouped' }) },
            }, t('manage')))),
        h('div', { className: 'bt-counts' },
          h('span', { className: 'bt-count is-pending' }, t('pending') + ' ', h('b', null, String(counts.pending))),
          h('span', { className: 'bt-count is-unread' }, t('unread') + ' ', h('b', null, String(counts.unread))),
          h('span', { className: 'bt-count is-running' }, t('running') + ' ', h('b', null, String(counts.running))),
          h('span', { className: 'bt-count' }, t('total') + ' ', h('b', null, String(all.length))),
          h('label', { className: 'bt-archived' },
            h('input', { type: 'checkbox', checked: showArchived, onChange: event => setShowArchived(event.target.checked) }),
            t('showArchived'))),
        snap.phase === 'error' ? h('div', { className: 'bt-empty' },
          t('loadError'), h('button', { type: 'button', className: 'bt-btn', onClick: () => { void refresh() } }, t('retry'))) : null,
        sections.length === 0 ? h('div', { className: 'bt-empty' }, t('empty')) : null,
        h('div', { className: 'bt-list' },
          sections.map(group => {
            const isCollapsed = collapsed[group.key] === true
            return h('div', { key: group.key, className: 'bt-group' },
              h('div', {
                className: 'bt-group-head',
                role: 'button',
                tabIndex: 0,
                'aria-expanded': !isCollapsed,
                onClick: () => toggleCollapsed(group.key),
                onKeyDown: event => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  toggleCollapsed(group.key)
                },
              },
              h('span', { className: 'bt-chevron' + (isCollapsed ? ' is-collapsed' : '') }, h(ChevronIcon, { size: 10 })),
              h('span', { className: 'bt-group-title' }, group.title),
              h('span', { className: 'bt-group-count' },
                group.filterId !== null ? `${group.shown.length}/${group.rows.length}` : String(group.rows.length))),
              !isCollapsed && group.tags.length > 0
                ? h('div', { className: 'bt-group-tags' },
                  group.tags.map(tag => h('button', {
                    key: tag.id, type: 'button',
                    className: 'bt-filter' + (group.filterId === tag.id ? ' is-on' : ''),
                    style: group.filterId === tag.id ? { borderColor: tag.color, color: tag.color } : undefined,
                    onClick: () => setTagFilter(group.key, group.filterId === tag.id ? null : tag.id),
                  }, tag.name)))
                : null,
              isCollapsed
                ? null
                : group.shown.length === 0
                  ? h('div', { className: 'bt-group-empty' }, t('empty'))
                  : h('div', { className: 'bt-group-rows' },
                    group.shown.map(({ summary, status }) => h('div', {
                      key: summary.id,
                      className: 'bt-row',
                      role: 'button',
                      tabIndex: 0,
                      onClick: () => openSession(summary.id),
                      onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openSession(summary.id) } },
                    },
                    h('span', { className: `bt-dot is-${status}` }),
                    h('span', { className: 'bt-row-title' }, summary.displayTitle || summary.title || String(summary.id)),
                    h('span', { className: 'bt-row-tags' },
                      sessionTags(summary.id).slice(0, 3).map(tag => h(Chip, { key: tag.key, tag })),
                      sessionTags(summary.id).length > 3 ? h('span', { className: 'bt-more' }, `+${sessionTags(summary.id).length - 3}`) : null),
                    h('span', { className: 'bt-row-status' }, t(status))))))
          })),
        report !== null ? h('div', { className: 'bt-toast' },
          t('importReportTitle') + ' · ' + t('importReport', {
            added: report.added.length, skipped: report.skipped.length, conflicts: report.conflicts.length,
          }),
          h('button', { type: 'button', className: 'bt-link', onClick: () => setReport(null) }, t('close'))) : null,
        currentUi.manager ? h(ManagerModal, {
          snap,
          initialQuery: currentUi.managerQuery,
          selectedKey: currentUi.managerKey,
          onSelectKey: key => commitUi({ managerKey: key }),
        }) : null,
        currentUi.importOpen ? h(ImportModal, { importText, setImportText, onPick: pickFile, onRun: doImport, fileRef }) : null,
        currentUi.settingsOpen && tagLimitForm !== null ? h(SettingsModal) : null)
    }

    function ManagerModal ({ snap, initialQuery = '', selectedKey, onSelectKey }) {
      const [query, setQuery] = useState(initialQuery)
      // A workspace created after the last /state fetch is missing from the
      // selector until a refresh lands.
      useEffect(() => { void refresh() }, [])
      // Every registered workspace, plus orphaned libraries whose workspace is
      // gone but whose tags still exist (renames and exports keep working).
      const options = []
      const listed = new Set()
      for (const entry of snap.workspaces ?? []) {
        listed.add(entry.key)
        options.push({ key: entry.key, title: entry.title })
      }
      for (const key of Object.keys(snap.libraries ?? {})) {
        if (!listed.has(key)) options.push({ key, title: key === 'ungrouped' ? t('ungrouped') : key })
      }
      if (options.length === 0) options.push({ key: 'ungrouped', title: t('ungrouped') })
      const key = selectedKey ?? options[0].key
      const scope = { workspaceKey: key }
      const tags = snap.libraries[key]?.tags ?? []
      const agentTools = snap.libraries[key]?.agentTools === true
      // Short lists scan faster without a filter; long lists need one. A query
      // carried in from the picker keeps the field visible so the user does not
      // lose the context they just typed.
      const showSearch = tags.length >= SEARCH_THRESHOLD || initialQuery !== '' || query !== ''
      const needle = showSearch ? query.trim().toLowerCase() : ''
      const matching = needle === ''
        ? tags
        : tags.filter(tag => tag.name.toLowerCase().includes(needle))
      return h('div', { className: 'bt-modal-back', onMouseDown: event => { if (event.target === event.currentTarget) commitUi({ manager: false }) } },
        h('div', { className: 'bt-modal' },
          h('div', { className: 'bt-modal-head bt-manager-head' },
            h('span', null, t('manage')),
            showSearch && tags.length > 0
              ? h('span', { className: 'bt-manager-count' }, `${matching.length}/${tags.length}`)
              : null),
          h('label', { className: 'bt-manager-ws' },
            h('span', { className: 'bt-manager-ws-label' }, t('workspace')),
            h('select', {
              className: 'bt-input bt-manager-ws-select',
              value: key,
              onChange: event => onSelectKey(event.target.value),
            }, options.map(option => h('option', { key: option.key, value: option.key }, option.title)))),
          h('label', { className: 'bt-switch-row' },
            h('input', {
              type: 'checkbox',
              checked: agentTools,
              onChange: event => { void setAgentTools(key, event.target.checked) },
            }),
            h('span', { className: 'bt-switch-text' },
              h('span', null, t('agentTools')),
              h('span', { className: 'bt-switch-hint' }, t('agentToolsHint')))),
          showSearch && tags.length > 0
            ? h('div', { className: 'bt-search-row bt-manager-search' },
              h('input', {
                className: 'bt-input bt-search', value: query, placeholder: t('searchPlaceholder'),
                maxLength: 16,
                autoFocus: true,
                onChange: event => setQuery(event.target.value),
              }),
              query === ''
                ? null
                : h('button', {
                  type: 'button', className: 'bt-search-clear',
                  title: t('clearSearch'), 'aria-label': t('clearSearch'),
                  onClick: () => setQuery(''),
                }, '×'))
            : null,
          h('div', { className: 'bt-manager' },
            tags.length === 0 ? h('div', { className: 'bt-picker-empty' }, t('noTags')) : null,
            showSearch && tags.length > 0 && matching.length === 0
              ? h('div', { className: 'bt-picker-empty' }, t('noMatch'))
              : null,
            matching.map(tag => h('div', { key: tag.id, className: 'bt-manager-row' },
              h('input', {
                className: 'bt-input bt-manager-name',
                defaultValue: tag.name,
                maxLength: 16,
                onBlur: event => { if (event.target.value.trim() !== tag.name) void updateTag(scope, tag.id, { name: event.target.value }) },
                onKeyDown: event => {
                  if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
                  event.preventDefault()
                  if (event.nativeEvent?.isComposing === true || event.nativeEvent?.keyCode === 229 || event.nativeEvent?.repeat === true) return
                  event.currentTarget.blur()
                },
              }),
              h(ColorControl, { tag, base: tags, onPick: color => { void updateTag(scope, tag.id, { color }) } }),
              h('button', {
                type: 'button', className: 'bt-btn bt-danger bt-manager-delete',
                onClick: () => { if (window.confirm(t('deleteConfirm'))) void deleteTag(scope, tag.id) },
              }, t('delete'))))),
          h('div', { className: 'bt-modal-foot bt-manager-foot' },
            h('button', { type: 'button', className: 'bt-btn', onClick: () => { void exportPack(key) } }, t('export')),
            h('button', { type: 'button', className: 'bt-btn', onClick: () => commitUi({ importOpen: true }) }, t('import')),
            h('button', { type: 'button', className: 'bt-btn', onClick: () => commitUi({ manager: false }) }, t('close')))))
    }

    function ImportModal ({ importText, setImportText, onPick, onRun, fileRef }) {
      return h('div', { className: 'bt-modal-back', onMouseDown: event => { if (event.target === event.currentTarget) commitUi({ importOpen: false }) } },
        h('div', { className: 'bt-modal' },
          h('div', { className: 'bt-modal-head' }, t('importTitle')),
          h('div', { className: 'bt-modal-hint' }, t('importHint')),
          h('textarea', {
            className: 'bt-textarea', value: importText, spellCheck: false, rows: 8,
            onChange: event => setImportText(event.target.value),
          }),
          h('div', { className: 'bt-modal-foot' },
            h('input', {
              ref: fileRef, type: 'file', accept: 'application/json,.json', style: { display: 'none' },
              onChange: event => { void onPick(event.target.files?.[0]) },
            }),
            h('button', { type: 'button', className: 'bt-btn', onClick: () => fileRef.current?.click() }, t('importFile')),
            h('button', { type: 'button', className: 'bt-btn', onClick: () => commitUi({ importOpen: false }) }, t('cancel')),
            h('button', { type: 'button', className: 'bt-btn is-primary', onClick: onRun }, t('importRun')))))
    }

    /**
     * The plugin's configuration card on its Plugins detail page
     * (`plugins.row.config`). Reads and writes the Host settings namespace
     * `dsh-better-tag` through the configForms service; the sidebar picks the
     * new limit up through this window's refresh plus the change feed's poke.
     */
    let tagLimitForm = null

    /** The sidebar-limit row, shared by the plugin's config page and the overview's settings modal. */
    function TagLimitField () {
      const snap = useSyncExternalStore(
        listener => tagLimitForm.subscribe(listener),
        () => tagLimitForm.getSnapshot(),
      )
      if (snap.status === 'unavailable') return null
      const raw = snap.value?.sidebarTagLimit
      const value = Number.isInteger(raw) ? Math.max(0, Math.min(5, raw)) : 2
      const disabled = snap.status !== 'ready' || snap.writable !== true
      return h(React.Fragment, null,
        h('label', { className: 'bt-settings-row' },
          h('span', { className: 'bt-settings-label' }, t('settingLimit')),
          h('select', {
            className: 'bt-input bt-settings-select',
            value: String(value),
            disabled,
            onChange: event => {
              const next = Number(event.target.value)
              void tagLimitForm.set('sidebarTagLimit', next).then(ok => { if (ok) void refresh() })
            },
          }, [0, 1, 2, 3, 4, 5].map(n => h('option', { key: n, value: String(n) }, String(n))))),
        h('div', { className: 'bt-settings-hint' }, t('settingLimitHint')))
    }

    function SettingsCard ({ view }) {
      // The detail page also renders this slot as a description fallback;
      // the form belongs on the full page view only.
      if (view !== 'page' || tagLimitForm === null) return null
      return h('div', { className: 'bt-settings' }, h(TagLimitField))
    }

    function SettingsModal () {
      return h('div', { className: 'bt-modal-back', onMouseDown: event => { if (event.target === event.currentTarget) commitUi({ settingsOpen: false }) } },
        h('div', { className: 'bt-modal bt-settings-modal' },
          h('div', { className: 'bt-modal-head' }, t('settingsTitle')),
          h(TagLimitField),
          h('div', { className: 'bt-modal-foot' },
            h('button', { type: 'button', className: 'bt-btn', onClick: () => commitUi({ settingsOpen: false }) }, t('close')))))
    }

    function GearIcon ({ size = 14 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true },
        h('path', {
          d: 'M8 5.4A2.6 2.6 0 1 0 8 10.6 2.6 2.6 0 0 0 8 5.4zm5.4 2.6c0-.4 0-.7-.1-1l1.3-1a.5.5 0 0 0 .1-.7l-1.2-2a.5.5 0 0 0-.6-.2l-1.5.6a5 5 0 0 0-1.7-1L9.4 1.5a.5.5 0 0 0-.5-.4H6.9a.5.5 0 0 0-.5.4l-.3 1.7a5 5 0 0 0-1.7 1l-1.5-.6a.5.5 0 0 0-.6.2l-1.2 2a.5.5 0 0 0 .1.7l1.3 1a5.6 5.6 0 0 0 0 2l-1.3 1a.5.5 0 0 0-.1.7l1.2 2c.1.2.4.3.6.2l1.5-.6a5 5 0 0 0 1.7 1l.3 1.7c0 .2.3.4.5.4h2.1c.2 0 .4-.2.5-.4l.3-1.7a5 5 0 0 0 1.7-1l1.5.6c.2.1.5 0 .6-.2l1.2-2a.5.5 0 0 0-.1-.7l-1.3-1c.1-.3.1-.6.1-1z',
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round',
        }))
    }

    function PanelIcon () {
      return h(TagIcon, { size: 16 })
    }

    /* ------------------------------------------------------------------ */
    /* styles                                                              */
    /* ------------------------------------------------------------------ */

    const CSS = `
.bt-row-tags{display:inline-flex;align-items:center;gap:3px;overflow:hidden;flex:0 1 auto}
[class*="rowResting"]{display:flex;align-items:center}
[class*="rowResting"] > span:has(.bt-row-tags){order:-1}
[class*="rowResting"] .bt-row-tags{order:-1}
.bt-chip{display:inline-flex;align-items:center;height:16px;max-width:64px;padding:0 5px;border-radius:3px;border:1px solid transparent;font-size:10px;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:0 0 auto}
.bt-chip-button{cursor:pointer;font:inherit;font-size:10px}
.bt-chip.is-temp{border-style:dashed;background:transparent}
.bt-chip.is-temp::before{content:'';width:4px;height:4px;border-radius:50%;background:currentColor;opacity:.75;margin-right:3px}
.bt-picker-sect{font-size:10px;letter-spacing:.4px;color:var(--dsw-alias-text-3,rgba(127,127,127,.9));border-top:1px solid var(--dsw-alias-border-1,rgba(127,127,127,.22));padding-top:7px;margin-top:2px}
.bt-temp-list{display:flex;flex-direction:column;gap:1px}
.bt-temp-row{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:5px}
.bt-temp-row:hover{background:var(--dsw-alias-bg-3,rgba(127,127,127,.13))}
.bt-temp-row .bt-pick-name{flex:1}
.bt-temp-action{border:0;background:transparent;color:var(--dsw-alias-text-3,rgba(127,127,127,.95));font:inherit;font-size:10.5px;cursor:pointer;padding:2px 4px;border-radius:3px}
.bt-temp-action:hover{background:var(--dsw-alias-bg-3,rgba(127,127,127,.16));color:var(--dsw-alias-text-1,inherit)}
.bt-swatch.is-temp{background:transparent !important;border:1px dashed currentColor}
.bt-chip-button:hover{filter:brightness(1.15)}
.bt-more{font-size:9.5px;color:var(--dsw-alias-text-3,rgba(127,127,127,.9));flex:0 0 auto}
.bt-menuitem{display:flex;align-items:center;gap:8px;width:100%;border:0;background:transparent;color:var(--dsw-alias-text-1,inherit);font:inherit;font-size:12px;text-align:left;padding:6px 8px;border-radius:5px;cursor:pointer}
.bt-menuitem:hover{background:var(--dsw-alias-bg-3,rgba(127,127,127,.14))}
.bt-menu-count{margin-left:auto;color:var(--dsw-alias-text-3,rgba(127,127,127,.9));font-size:11px}
.bt-hover{display:flex;flex-direction:column;gap:4px;margin:4px 0 6px;min-width:0}
.bt-hover-head{font-size:10px;letter-spacing:.4px;text-transform:uppercase;color:var(--dsw-alias-text-3,rgba(127,127,127,.9))}
.bt-hover-chips{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.bt-head-tags{display:inline-flex;align-items:center;gap:4px;min-width:0;overflow:hidden;flex:0 1 auto}
.bt-head-tags .bt-chip{height:20px;max-width:110px;font-size:11px;padding:0 7px}
.bt-add-tag{height:20px;border:1px dashed var(--dsw-alias-border-2,rgba(127,127,127,.45));border-radius:4px;background:transparent;color:var(--dsw-alias-text-3,rgba(127,127,127,.9));font-size:11px;padding:0 7px;cursor:pointer;flex:0 0 auto}
.bt-add-tag:hover{color:var(--dsw-alias-text-1,inherit)}
.bt-overlay{position:fixed;inset:0;z-index:2147483000;pointer-events:auto}
.bt-picker{position:fixed;background:var(--dsw-alias-bg-1,#1e2129);border:1px solid var(--dsw-alias-border-1,rgba(127,127,127,.3));border-radius:10px;box-shadow:0 16px 44px rgba(0,0,0,.45);padding:8px;display:flex;flex-direction:column;gap:6px;max-height:min(470px,calc(100vh - 16px));overflow:auto}
.bt-picker-head{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--dsw-alias-text-3,rgba(127,127,127,.9));padding:2px 4px}
.bt-picker-head-count{margin-left:auto;font-size:10px;color:var(--dsw-alias-text-3,rgba(127,127,127,.8))}
.bt-search-row{display:flex;gap:4px;align-items:center}
.bt-search{height:26px}
.bt-search-clear{display:grid;place-items:center;width:22px;height:22px;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-text-3,rgba(127,127,127,.95));font:inherit;font-size:14px;line-height:1;cursor:pointer;flex:0 0 auto}
.bt-search-clear:hover{background:var(--dsw-alias-bg-3,rgba(127,127,127,.16));color:var(--dsw-alias-text-1,inherit)}
.bt-picker-list{flex:1 1 auto;min-height:0;max-height:280px;overflow:auto;display:flex;flex-direction:column;gap:1px}
.bt-pick-row{display:flex;flex-wrap:wrap;align-items:center;gap:2px;padding:0 4px;border-radius:5px}
.bt-pick-row:hover,.bt-pick-row.is-on{background:var(--dsw-alias-bg-3,rgba(127,127,127,.13))}
.bt-pick-main{display:flex;align-items:center;gap:8px;flex:1;min-width:0;border:0;background:transparent;color:var(--dsw-alias-text-1,inherit);font:inherit;font-size:12px;text-align:left;padding:6px 2px;cursor:pointer}
.bt-pick-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-pick-check{color:#4fbf82;display:flex}
.bt-picker-empty{font-size:11.5px;color:var(--dsw-alias-text-3,rgba(127,127,127,.9));padding:6px}
.bt-picker-create-query{display:flex;align-items:center;gap:6px;border:0;background:transparent;color:var(--dsw-alias-text-1,inherit);font:inherit;font-size:12px;text-align:left;padding:6px;border-radius:5px;cursor:pointer}
.bt-picker-create-query:hover{background:var(--dsw-alias-bg-3,rgba(127,127,127,.13))}
.bt-color-wrap{display:contents}
.bt-color-dot{width:14px;height:14px;border-radius:50%;border:1px solid rgba(255,255,255,.35);padding:0;cursor:pointer;flex:0 0 auto;box-shadow:0 0 0 1px rgba(0,0,0,.18)}
.bt-color-dot:hover{transform:scale(1.15)}
.bt-color-dot.is-open{box-shadow:0 0 0 2px var(--dsw-alias-text-3,rgba(127,127,127,.9))}
.bt-color-pop{flex-basis:100%;display:flex;flex-wrap:wrap;gap:4px;align-items:center;padding:5px 4px 5px 10px;margin:0 0 3px;border-top:1px dashed var(--dsw-alias-border-1,rgba(127,127,127,.22))}
.bt-color-swatch{width:16px;height:16px;border-radius:4px;border:1px solid transparent;padding:0;cursor:pointer}
.bt-color-swatch.is-on{outline:2px solid var(--dsw-alias-text-1,#fff);outline-offset:1px}
.bt-color-random{height:16px;border-radius:4px;border:1px solid var(--dsw-alias-border-2,rgba(127,127,127,.4));background:transparent;color:var(--dsw-alias-text-3,rgba(127,127,127,.95));font:inherit;font-size:10px;line-height:1;padding:0 6px;cursor:pointer}
.bt-color-random:hover{background:var(--dsw-alias-bg-3,rgba(127,127,127,.16));color:var(--dsw-alias-text-1,inherit)}
.bt-picker-new{display:flex;gap:5px;border-top:1px solid var(--dsw-alias-border-1,rgba(127,127,127,.22));padding-top:7px}
.bt-input{flex:1;min-width:0;height:26px;border-radius:5px;border:1px solid var(--dsw-alias-border-2,rgba(127,127,127,.4));background:var(--dsw-alias-bg-2,rgba(127,127,127,.08));color:var(--dsw-alias-text-1,inherit);font:inherit;font-size:12px;padding:0 8px}
.bt-btn{height:26px;border-radius:5px;border:1px solid var(--dsw-alias-border-2,rgba(127,127,127,.4));background:var(--dsw-alias-bg-2,rgba(127,127,127,.08));color:var(--dsw-alias-text-1,inherit);font:inherit;font-size:12px;padding:0 10px;cursor:pointer}
.bt-btn:hover{background:var(--dsw-alias-bg-3,rgba(127,127,127,.16))}
.bt-btn.is-primary{background:#3b5bd6;border-color:#3b5bd6;color:#fff}
.bt-btn.bt-danger{color:#f07a7a;border-color:rgba(240,122,122,.4)}
.bt-link{border:0;background:transparent;color:var(--dsw-alias-text-3,rgba(127,127,127,.95));font:inherit;font-size:12px;text-align:left;padding:4px;cursor:pointer;text-decoration:underline}
.bt-swatch{width:8px;height:8px;border-radius:2px;flex:0 0 auto}
.bt-settings{padding:10px 2px 2px}
.bt-settings-modal{width:min(420px,90vw)}
.bt-icon-btn{display:inline-flex;align-items:center;justify-content:center;padding:0 8px}
.bt-settings-row{display:flex;align-items:center;gap:10px}
.bt-settings-label{font-size:12.5px}
.bt-settings-select{width:76px;height:26px;flex:0 0 auto}
.bt-settings-hint{font-size:11px;color:var(--dsw-alias-text-3,rgba(127,127,127,.9));margin-top:6px}
.bt-panel{padding:20px 24px 40px;height:100%;overflow:auto;color:var(--dsw-alias-text-1,inherit)}
.bt-panel-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:10px;flex-wrap:wrap}
.bt-panel-title{margin:0;font-size:16px;font-weight:600}
.bt-panel-sub{font-size:11.5px;color:var(--dsw-alias-text-3,rgba(127,127,127,.9));margin-top:2px}
.bt-toolbar{display:flex;gap:6px;margin-left:auto;flex-wrap:wrap}
.bt-counts{display:flex;gap:16px;flex-wrap:wrap;font-size:11.5px;color:var(--dsw-alias-text-3,rgba(127,127,127,.95));margin:8px 0 12px}
.bt-count b{color:var(--dsw-alias-text-1,inherit);font-weight:600;margin-left:2px}
.bt-count.is-pending b{color:#f0a35e}
.bt-count.is-unread b{color:#4fbf82}
.bt-count.is-running b{color:#5b8cff}
.bt-filter{height:22px;border-radius:999px;border:1px solid var(--dsw-alias-border-2,rgba(127,127,127,.35));background:transparent;color:var(--dsw-alias-text-3,rgba(127,127,127,.95));font:inherit;font-size:11px;padding:0 9px;cursor:pointer}
.bt-filter.is-on{border-color:#4a5a8a;background:rgba(74,90,138,.18);color:var(--dsw-alias-text-1,inherit)}
.bt-archived{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--dsw-alias-text-3,rgba(127,127,127,.9));margin-left:auto}
.bt-list{display:flex;flex-direction:column;gap:1px}
.bt-group + .bt-group{margin-top:12px}
.bt-group-head{display:flex;align-items:center;gap:6px;padding:3px 9px 6px;border-radius:6px;cursor:pointer;user-select:none}
.bt-group-head:hover{background:var(--dsw-alias-bg-3,rgba(127,127,127,.1))}
.bt-chevron{display:inline-flex;color:var(--dsw-alias-text-3,rgba(127,127,127,.9));transition:transform .12s ease}
.bt-chevron.is-collapsed{transform:rotate(-90deg)}
.bt-group-title{font-size:11.5px;font-weight:600;letter-spacing:.3px;color:var(--dsw-alias-text-2,rgba(190,195,205,.95))}
.bt-group-count{font-size:10px;color:var(--dsw-alias-text-3,rgba(127,127,127,.85))}
.bt-group-tags{display:flex;gap:5px;flex-wrap:wrap;align-items:center;padding:1px 9px 0 25px}
.bt-group-empty{padding:2px 9px 8px 25px;font-size:11.5px;color:var(--dsw-alias-text-3,rgba(127,127,127,.85))}
.bt-row{display:flex;align-items:center;gap:10px;padding:7px 9px;border-radius:7px;cursor:pointer;min-width:0}
.bt-row:hover{background:var(--dsw-alias-bg-3,rgba(127,127,127,.12))}
.bt-row-title{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px}
.bt-row-tags{display:flex;gap:3px;flex:0 1 auto;overflow:hidden;max-width:240px}
.bt-row-status{flex:0 0 62px;text-align:right;font-size:11px;color:var(--dsw-alias-text-3,rgba(127,127,127,.95));white-space:nowrap}
.bt-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto;background:#454a55}
.bt-dot.is-pending{background:#f0a35e}
.bt-dot.is-unread{background:#4fbf82}
.bt-dot.is-running{background:#5b8cff;box-shadow:0 0 0 3px rgba(91,140,255,.12)}
.bt-empty{padding:22px 4px;color:var(--dsw-alias-text-3,rgba(127,127,127,.9));font-size:12px;display:flex;gap:8px;align-items:center}
.bt-toast{pointer-events:none;position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--dsw-alias-bg-1,#1e2129);border:1px solid var(--dsw-alias-border-1,rgba(127,127,127,.3));border-radius:8px;padding:8px 12px;font-size:12px;display:flex;gap:10px;align-items:center;box-shadow:0 10px 30px rgba(0,0,0,.4);z-index:2147483001}
.bt-modal-back{position:fixed;inset:0;background:rgba(0,0,0,.45);display:grid;place-items:center;z-index:2147483002}
.bt-modal{width:min(560px,90vw);max-height:80vh;overflow:auto;background:var(--dsw-alias-bg-1,#1e2129);border:1px solid var(--dsw-alias-border-1,rgba(127,127,127,.3));border-radius:12px;padding:16px;box-shadow:0 24px 60px rgba(0,0,0,.5)}
.bt-modal-head{font-size:14px;font-weight:600;margin-bottom:8px}
.bt-modal-hint{font-size:12px;color:var(--dsw-alias-text-3,rgba(127,127,127,.9));margin-bottom:8px}
.bt-manager{display:flex;flex-direction:column;gap:8px;max-height:52vh;overflow:auto}
.bt-manager-ws{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.bt-manager-ws-label{font-size:12px;color:var(--dsw-alias-text-3,rgba(127,127,127,.95));flex:0 0 auto}
.bt-manager-ws-select{flex:1;min-width:0;height:28px}
.bt-switch-row{display:flex;align-items:flex-start;gap:8px;padding:8px;border:1px solid var(--dsw-alias-border-1,rgba(127,127,127,.25));border-radius:8px;margin-bottom:8px;cursor:pointer}
.bt-switch-row input{margin-top:2px}
.bt-switch-text{display:flex;flex-direction:column;gap:2px;font-size:12px}
.bt-switch-hint{font-size:11px;color:var(--dsw-alias-text-3,rgba(127,127,127,.9))}
.bt-manager-foot{justify-content:flex-start}
.bt-manager-foot .bt-btn:last-child{margin-left:auto}
.bt-manager-head{display:flex;align-items:center;gap:8px}
.bt-manager-count{margin-left:auto;font-size:11px;font-weight:400;color:var(--dsw-alias-text-3,rgba(127,127,127,.9))}
.bt-manager-search{margin-bottom:8px}
.bt-manager-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:2px 0}
.bt-manager-name{flex:0 0 150px}
.bt-manager-delete{order:1;margin-left:auto}
.bt-manager-row .bt-color-pop{order:2}
.bt-textarea{width:100%;min-height:140px;border-radius:8px;border:1px solid var(--dsw-alias-border-2,rgba(127,127,127,.4));background:var(--dsw-alias-bg-2,rgba(127,127,127,.08));color:var(--dsw-alias-text-1,inherit);font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;padding:8px;resize:vertical}
.bt-modal-foot{display:flex;gap:8px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap}
`

    function installStyles () {
      try {
        if (typeof styles !== 'undefined' && styles !== null && typeof styles.insert === 'function') return styles.insert(CSS)
      } catch { /* fall through */ }
      const element = document.createElement('style')
      element.setAttribute('data-dsh-better-tag', '')
      element.textContent = CSS
      document.head.appendChild(element)
      return () => { element.remove() }
    }

    /* ------------------------------------------------------------------ */
    /* apply                                                               */
    /* ------------------------------------------------------------------ */

    let ctxRef = {}

    function service (name) {
      try { return ctxRef.get?.(name) } catch { return undefined }
    }

    function selectPanel (key) {
      try { service('layout')?.selectPanel?.(key) } catch { /* ignore */ }
    }

    function openSessionById (sessionId) {
      try { service('uiWorkspace')?.openSession?.(sessionId) } catch { /* ignore */ }
    }

    function installLocale (ctx) {
      try {
        if (ctx?.locale === undefined) return
        ctx.locale.register(NS, DICTS)
        translate = ctx.locale.bind(NS)
      } catch (error) {
        console.warn('[dsh-better-tag] locale registration failed; keeping Chinese copy', error)
      }
    }

    function MenuClearTempItem ({ sessionId, useMenuOpenState }) {
      const [, setMenuOpen] = useMenuOpenState()
      const { meta } = useSessionMeta(sessionId)
      if ((meta?.inlineTags?.length ?? 0) === 0) return null
      return h('button', {
        type: 'button', role: 'menuitem', className: 'bt-menuitem',
        onClick: () => { setMenuOpen(false); void saveSession(sessionId, { inlineTags: [] }) },
      }, t('menuClearTemp'))
    }

    function apply (ctx) {
      ctxRef = ctx
      installLocale(ctx)
      const disposers = []
      try {
        const disposeStyles = installStyles()
        if (typeof disposeStyles === 'function') disposers.push(disposeStyles)
      } catch (error) {
        console.warn('[dsh-better-tag] styles failed', error)
      }

      const contribute = (ownerKey, options, Component) => {
        try {
          disposers.push(ctx.slots.inject(ownerKey, () => ctx.slots.register(options, Component)))
        } catch (error) {
          console.warn('[dsh-better-tag] slot registration failed', ownerKey, error)
        }
      }

      try {
        const stopEvents = startEvents()
        if (stopEvents !== null) disposers.push(stopEvents)
      } catch (error) {
        console.warn('[dsh-better-tag] events stream failed', error)
      }

      contribute('sidebar.session.row.trailing', {
        name: 'sidebar.session.row.trailing', id: 'better-tag-chips', order: 100, locale: NS,
      }, RowTags)
      contribute('sidebar.session.row.hover', {
        name: 'sidebar.session.row.hover', id: 'better-tag-hover', order: 10, locale: NS,
      }, HoverTags)
      contribute('sidebar.workspaces.session.menu.item', {
        name: 'sidebar.workspaces.session.menu.item', id: 'better-tag-menu-clear-temp', order: 390, locale: NS,
      }, MenuClearTempItem)
      contribute('sidebar.workspaces.session.menu.item', {
        name: 'sidebar.workspaces.session.menu.item', id: 'better-tag-menu-tags', order: 410, locale: NS,
      }, MenuTagsItem)
      contribute('conversation.session.header.actions', {
        name: 'conversation.session.header.actions', id: 'better-tag-header', order: 60, locale: NS,
      }, HeaderTags)
      contribute('shell.overlay', {
        name: 'shell.overlay', id: 'better-tag-picker', order: 60, locale: NS,
      }, PickerOverlay)
      contribute('main', { name: 'main', key: PANEL_ID, locale: NS }, OverviewPanel)
      contribute('sidebar.panellist', {
        name: 'sidebar.panellist', id: PANEL_ID, order: 55, locale: NS,
        label: () => t('nav'),
      }, PanelIcon)

      try {
        tagLimitForm = ctx.get?.('configForms')?.get?.('dsh-better-tag') ?? null
      } catch { tagLimitForm = null }
      if (tagLimitForm !== null) {
        contribute('plugins.row.config', {
          name: 'plugins.row.config', key: 'dsh-better-tag#dsh-better-tag', locale: NS,
        }, SettingsCard)
      }

      void refresh()

      try {
        const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
        document.addEventListener('visibilitychange', onVisible)
        disposers.push(() => document.removeEventListener('visibilitychange', onVisible))
      } catch { /* ignore */ }

      return () => {
        for (const dispose of disposers.reverse()) {
          try { dispose() } catch { /* ignore */ }
        }
      }
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
