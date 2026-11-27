/**
 * Host half of dsh-better-tag.
 *
 * Owns the durable per-workspace tag stores and their same-origin API. It
 * never writes Session logs and never touches the agent loop: tags and the
 * done stamp belong to the human. When a workspace flips its model-tools
 * switch on, the four tag tools attach to the scoped context of every agent
 * in that workspace — and only there — so agents elsewhere never see them.
 */

import os from 'node:os'
import path from 'node:path'
import { createStore, UNGROUPED } from './src/store.js'
import { registerLocalApi } from './src/http.js'
import { createTagTools } from './src/tools.js'

export const name = 'dsh-better-tag'
export const inject = ['webServer']

function storeDir () {
  const home = process.env.DSH_HOME
  if (typeof home === 'string' && home !== '') return path.join(home, 'storages', 'better-tag')
  return path.join(process.env.HOME ?? os.homedir(), '.dsh', 'storages', 'better-tag')
}

/**
 * Activate the plugin.
 * @param {object} ctx - Cordis plugin context.
 * @returns a disposer that releases every registration.
 */
export function apply (ctx) {
  const log = console
  const store = createStore({ dir: storeDir(), log })
  const disposers = []

  /**
   * The library key of one Session: the id of the workspace accounting it,
   * or the shared ungrouped bucket when no registered workspace claims it.
   *
   * Workspace membership lives in the registry's durable record, and a
   * brand-new Session reaches `agent/created` (and its first tag writes)
   * before the controller accounts it there. Fall back to the Session's
   * canonical cwd — the same equality the registry itself uses to match
   * membership — so new Sessions resolve to their workspace immediately.
   */
  const workspaceKeyOf = sessionId => {
    try {
      const workspaces = ctx.get('workspaceRegistry')?.list?.() ?? []
      for (const workspace of workspaces) {
        if ((workspace.sessionIds ?? []).includes(sessionId)) return String(workspace.id)
      }
      const cwd = ctx.get('sessions')?.get?.(sessionId)?.header?.cwd
      if (typeof cwd === 'string' && cwd !== '') {
        const needle = cwd.replace(/\/+$/, '')
        for (const workspace of workspaces) {
          if (String(workspace.path ?? '').replace(/\/+$/, '') === needle) return String(workspace.id)
        }
      }
    } catch (error) {
      log.warn?.(`[better-tag] workspace lookup failed: ${error.message}`)
    }
    return UNGROUPED
  }

  const workspaceEntries = () => {
    try {
      return (ctx.get('workspaceRegistry')?.list?.() ?? []).map(workspace => ({
        key: String(workspace.id),
        title: workspace.title,
        sessionIds: [...(workspace.sessionIds ?? [])].map(String),
      }))
    } catch {
      return []
    }
  }

  /* ------------------------------------------------------------------ */
  /* model tools: attached per agent while its workspace enables them    */
  /* ------------------------------------------------------------------ */

  const toolDefinitions = createTagTools({ store, resolveKey: workspaceKeyOf, log })
  /** agentId -> disposer removing that agent's four tag tools. */
  const attached = new Map()

  const attachTools = agent => {
    const id = String(agent?.id ?? '')
    if (id === '' || attached.has(id)) return
    const own = []
    try {
      for (const definition of toolDefinitions) own.push(agent.ctx.tools.register(definition))
    } catch (error) {
      for (const dispose of own.reverse()) { try { dispose() } catch { /* ignore */ } }
      log.warn?.(`[better-tag] tool registration for agent ${id} failed: ${error.message}`)
      return
    }
    attached.set(id, () => {
      for (const dispose of own.reverse()) { try { dispose() } catch { /* ignore */ } }
    })
  }

  const detachTools = agentId => {
    const dispose = attached.get(agentId)
    attached.delete(agentId)
    try { dispose?.() } catch { /* ignore */ }
  }

  /** Bring every live agent of one workspace to that workspace's switch state. */
  const syncWorkspaceTools = async key => {
    const enabled = await store.agentToolsEnabled(key)
    for (const agent of ctx.get('agents')?.list?.() ?? []) {
      if (workspaceKeyOf(String(agent.id)) !== key) continue
      if (enabled) attachTools(agent)
      else detachTools(String(agent.id))
    }
  }

  disposers.push(registerLocalApi({
    webServer: ctx.webServer,
    store,
    log,
    resolveKey: workspaceKeyOf,
    workspaces: workspaceEntries,
    onAgentTools: key => {
      void syncWorkspaceTools(key).catch(error => log.warn?.(`[better-tag] agent tools sync failed: ${error.message}`))
    },
  }))

  try {
    disposers.push(ctx.on('agent/created', async ({ agent }) => {
      if (await store.agentToolsEnabled(workspaceKeyOf(String(agent.id)))) attachTools(agent)
    }))
    disposers.push(ctx.on('agent/disposed', ({ agent }) => {
      // The agent scope already unwound its registrations; drop our record.
      attached.delete(String(agent.id))
    }))
  } catch (error) {
    log.warn?.(`[better-tag] agent listeners failed: ${error.message}`)
  }

  // Agents that went live before this plugin loaded (hot reload) still get
  // their workspace's tools.
  void store.ready
    .then(async () => {
      const keys = Object.entries(store.state().libraries)
        .filter(([, library]) => library.agentTools === true)
        .map(([key]) => key)
      for (const key of keys) await syncWorkspaceTools(key)
    })
    .catch(error => log.warn?.(`[better-tag] initial agent tools sync failed: ${error.message}`))

  try {
    disposers.push(ctx.on('api-session/activity', sessionId => {
      void store.clearDone(String(sessionId)).catch(error => log.warn?.(`[better-tag] clear done failed: ${error.message}`))
    }))
  } catch (error) {
    log.warn?.(`[better-tag] activity listener failed: ${error.message}`)
  }

  try {
    disposers.push(ctx.on('session/created', session => {
      const live = () => ctx.get('sessions')?.list?.() ?? []
      void store.inheritFork(session, live, workspaceKeyOf)
        .catch(error => log.warn?.(`[better-tag] fork inherit failed: ${error.message}`))
    }))
  } catch (error) {
    log.warn?.(`[better-tag] created listener failed: ${error.message}`)
  }

  // Current DSH forks do not record their source on the child header, so the
  // controller's fork call is the one place that still knows both ids. Wrap it
  // best-effort. The marker keeps repeated plugin reloads from stacking
  // wrappers: a reload reuses the true original and replaces the previous
  // wrapper instead of wrapping it again.
  const FORK_MARK = Symbol.for('dsh-better-tag.fork-wrap')
  try {
    const controller = ctx.get('sessionController')
    if (controller !== undefined && typeof controller.fork === 'function') {
      const previous = controller[FORK_MARK]
      const original = typeof previous?.original === 'function' ? previous.original : controller.fork
      const patched = async request => {
        const value = await original.call(controller, request)
        try {
          const childId = String(value.sessionId)
          await store.copyTags(String(request.sessionId), childId, workspaceKeyOf(childId))
        } catch (error) {
          log.warn?.(`[better-tag] fork copy failed: ${error.message}`)
        }
        return value
      }
      controller.fork = patched
      controller[FORK_MARK] = { original, patched }
      disposers.push(() => {
        if (controller.fork === patched) controller.fork = original
        if (controller[FORK_MARK]?.patched === patched) delete controller[FORK_MARK]
      })
    }
  } catch (error) {
    log.warn?.(`[better-tag] fork wrap unavailable: ${error.message}`)
  }

  const disposeAll = () => {
    for (const dispose of disposers.reverse()) {
      try { dispose() } catch { /* ignore */ }
    }
    for (const agentId of [...attached.keys()]) detachTools(agentId)
  }

  try {
    ctx.effect(() => disposeAll, 'dsh-better-tag: lifecycle')
    return undefined
  } catch {
    return disposeAll
  }
}
