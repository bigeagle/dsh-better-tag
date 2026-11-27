import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { apply } from '../index.js'

function makeAgent (id) {
  const tools = new Map()
  return {
    id,
    tools,
    ctx: {
      tools: {
        register (definition) {
          if (tools.has(definition.name)) throw new Error(`tool "${definition.name}" is already registered in this scope`)
          tools.set(definition.name, definition)
          return () => { tools.delete(definition.name) }
        },
      },
    },
  }
}

async function startPlugin (options = {}) {
  const home = options.home ?? await fs.mkdtemp(path.join(os.tmpdir(), 'better-tag-home-'))
  const ownsHome = options.home === undefined
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home

  const listeners = new Map()
  const server = http.createServer()
  const controller = {
    calls: [],
    async fork (request) {
      this.calls.push(request)
      return { sessionId: 'child-session' }
    },
  }
  const liveSessions = []
  const workspaces = [
    { id: 'ws-1', title: 'One', sessionIds: ['s1', 's2'], path: '/ws/one' },
    { id: 'ws-2', title: 'Two', sessionIds: ['s3'], path: '/ws/two' },
  ]
  const agents = []
  const ctx = {
    webServer: {
      register (route) { server.on('request', route.handler); return () => { server.removeListener('request', route.handler) } },
    },
    on (name, listener) {
      const set = listeners.get(name) ?? new Set()
      set.add(listener)
      listeners.set(name, set)
      return () => set.delete(listener)
    },
    get (name) {
      if (name === 'sessions') return { list: () => liveSessions, get: id => liveSessions.find(session => String(session.id) === id) }
      if (name === 'sessionController') return controller
      if (name === 'workspaceRegistry') return { list: () => workspaces }
      if (name === 'agents') return { list: () => agents }
      return undefined
    },
    effect (callback) {
      const dispose = callback()
      return () => { if (typeof dispose === 'function') dispose() }
    },
  }

  const dispose = apply(ctx)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/dsh-better-tag/v1`
  const emit = async (name, ...args) => {
    for (const listener of listeners.get(name) ?? []) await listener(...args)
  }
  const close = async () => {
    if (typeof dispose === 'function') dispose()
    await new Promise(resolve => server.close(resolve))
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    if (ownsHome) await fs.rm(home, { recursive: true, force: true })
  }
  return { base, emit, close, controller, liveSessions, workspaces, agents, home }
}

async function waitFor (check, timeout = 800) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await check()) return true
    await new Promise(resolve => setTimeout(resolve, 15))
  }
  return false
}

async function call (base, pathname, { method = 'GET', body } = {}) {
  const headers = { accept: 'application/json' }
  if (method === 'POST') headers['x-better-tag'] = '1'
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(base + pathname, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return response.json()
}

test('activity clears a done stamp through the plugin listener', async () => {
  const plugin = await startPlugin()
  try {
    const created = await call(plugin.base, '/tags', { method: 'POST', body: { sessionId: 's1', name: '报税' } })
    const tagId = created.tag.id
    await call(plugin.base, '/session', { method: 'POST', body: { sessionId: 's1', tagIds: [tagId], done: true } })

    await plugin.emit('api-session/activity', 's1', Date.now())
    const cleared = await waitFor(async () => (await call(plugin.base, '/state')).sessions.s1.done === false)
    assert.equal(cleared, true)

    const state = await call(plugin.base, '/state')
    assert.deepEqual(state.sessions.s1.tagIds, [tagId])
  } finally {
    await plugin.close()
  }
})

test('state maps sessions to workspaces and materializes their libraries', async () => {
  const plugin = await startPlugin()
  try {
    const state = await call(plugin.base, '/state')
    assert.deepEqual(state.sessionWorkspaces, { s1: 'ws-1', s2: 'ws-1', s3: 'ws-2' })
    assert.deepEqual(Object.keys(state.libraries).sort(), ['ws-1', 'ws-2'])
    assert.deepEqual(state.workspaces, [
      { key: 'ws-1', title: 'One' },
      { key: 'ws-2', title: 'Two' },
    ])
  } finally {
    await plugin.close()
  }
})

test('a fork created with shared seed events inherits tags but not done', async () => {
  const plugin = await startPlugin()
  try {
    const created = await call(plugin.base, '/tags', { method: 'POST', body: { name: '产品' } })
    const tagId = created.tag.id
    await call(plugin.base, '/session', { method: 'POST', body: { sessionId: 'parent', tagIds: [tagId], done: true } })

    const first = { type: 'user/message', seq: 0 }
    const parent = { id: 'parent', header: { isSeeded: false }, events: [first] }
    plugin.liveSessions.push(parent)
    const child = { id: 'child', header: { isSeeded: true }, events: [first] }

    await plugin.emit('session/created', child)
    const inherited = await waitFor(async () => (await call(plugin.base, '/state')).sessions.child?.tagIds?.length === 1)
    assert.equal(inherited, true)

    const state = await call(plugin.base, '/state')
    assert.deepEqual(state.sessions.child.tagIds, [tagId])
    assert.equal(state.sessions.child.done, false)
  } finally {
    await plugin.close()
  }
})

test('the controller fork wrapper copies tags to the child', async () => {
  const plugin = await startPlugin()
  try {
    const created = await call(plugin.base, '/tags', { method: 'POST', body: { name: '交付' } })
    const tagId = created.tag.id
    await call(plugin.base, '/session', { method: 'POST', body: { sessionId: 'source', tagIds: [tagId] } })

    await plugin.controller.fork({ sessionId: 'source' })
    const copied = await waitFor(async () => (await call(plugin.base, '/state')).sessions['child-session']?.tagIds?.length === 1)
    assert.equal(copied, true)

    const state = await call(plugin.base, '/state')
    assert.deepEqual(state.sessions['child-session'].tagIds, [tagId])
    assert.equal(state.sessions['child-session'].done, false)
  } finally {
    await plugin.close()
  }
})

test('model tools attach per agent only while its workspace enables them', async () => {
  const plugin = await startPlugin()
  try {
    const a1 = makeAgent('s1')
    plugin.agents.push(a1)
    await plugin.emit('agent/created', { agent: a1 })
    // The switch defaults off: no tools.
    assert.equal(a1.tools.size, 0)

    await call(plugin.base, '/agent-tools', { method: 'POST', body: { workspaceKey: 'ws-1', enabled: true } })
    assert.equal(await waitFor(() => a1.tools.size === 4), true)
    assert.deepEqual([...a1.tools.keys()].sort(), ['session_tags_get', 'session_tags_library_list', 'session_tags_library_update', 'session_tags_set'])

    // An agent created afterwards in the same workspace gets the tools too;
    // an agent of another workspace never does.
    const a2 = makeAgent('s2')
    plugin.agents.push(a2)
    await plugin.emit('agent/created', { agent: a2 })
    assert.equal(a2.tools.size, 4)
    const b1 = makeAgent('s3')
    plugin.agents.push(b1)
    await plugin.emit('agent/created', { agent: b1 })
    assert.equal(b1.tools.size, 0)

    await call(plugin.base, '/agent-tools', { method: 'POST', body: { workspaceKey: 'ws-1', enabled: false } })
    assert.equal(await waitFor(() => a1.tools.size === 0 && a2.tools.size === 0), true)

    // Disposal drops the record without touching the (already unwound) scope.
    await plugin.emit('agent/disposed', { agent: a1 })
  } finally {
    await plugin.close()
  }
})

test('a brand-new session resolves its workspace by cwd before the registry accounts it', async () => {
  const plugin = await startPlugin()
  try {
    await call(plugin.base, '/agent-tools', { method: 'POST', body: { workspaceKey: 'ws-1', enabled: true } })
    await call(plugin.base, '/agent-tools', { method: 'POST', body: { workspaceKey: 'ws-2', enabled: true } })
    // Live, but ws-1's durable record does not list it yet: agent/created
    // fires before the workspace controller accounts a new session.
    plugin.liveSessions.push({ id: 's9', header: { cwd: '/ws/one', isSeeded: false } })
    const a9 = makeAgent('s9')
    plugin.agents.push(a9)
    await plugin.emit('agent/created', { agent: a9 })
    assert.equal(a9.tools.size, 4)

    // A trailing slash on the header cwd still matches the workspace path.
    plugin.liveSessions.push({ id: 's10', header: { cwd: '/ws/two/', isSeeded: false } })
    const a10 = makeAgent('s10')
    plugin.agents.push(a10)
    await plugin.emit('agent/created', { agent: a10 })
    assert.equal(a10.tools.size, 4)

    // A cwd matching no workspace stays ungrouped, and ungrouped is off.
    plugin.liveSessions.push({ id: 's11', header: { cwd: '/elsewhere', isSeeded: false } })
    const a11 = makeAgent('s11')
    plugin.agents.push(a11)
    await plugin.emit('agent/created', { agent: a11 })
    assert.equal(a11.tools.size, 0)
  } finally {
    await plugin.close()
  }
})

test('an agent live before a hot reload gets tools for an enabled workspace', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'better-tag-home-'))
  try {
    const first = await startPlugin({ home })
    await call(first.base, '/agent-tools', { method: 'POST', body: { workspaceKey: 'ws-1', enabled: true } })
    await first.close()

    // Second apply over the same DSH_HOME: the persisted switch reattaches
    // to agents that are already live, without any agent/created event.
    const second = await startPlugin({ home })
    try {
      const a1 = makeAgent('s1')
      second.agents.push(a1)
      assert.equal(await waitFor(() => a1.tools.size === 4), true)
    } finally {
      await second.close()
    }
  } finally {
    await fs.rm(home, { recursive: true, force: true })
  }
})

test('the tag tools read and edit the calling agent workspace library', async () => {
  const plugin = await startPlugin()
  try {
    await call(plugin.base, '/agent-tools', { method: 'POST', body: { workspaceKey: 'ws-1', enabled: true } })
    const a1 = makeAgent('s1')
    plugin.agents.push(a1)
    await plugin.emit('agent/created', { agent: a1 })
    assert.equal(await waitFor(() => a1.tools.size === 4), true)
    const exec = { agent: a1 }

    const set = await a1.tools.get('session_tags_set').execute({ tags: ['报税', '发布'] }, exec)
    assert.deepEqual(set.assigned.map(tag => tag.name), ['报税', '发布'])

    const listed = await a1.tools.get('session_tags_library_list').execute({}, exec)
    assert.equal(listed.library.length, 2)
    assert.equal(listed.assigned, undefined)

    const got = await a1.tools.get('session_tags_get').execute({}, exec)
    assert.deepEqual(got.tags.map(tag => tag.name), ['报税', '发布'])
    assert.ok(got.tags.every(tag => typeof tag.color === 'string'))

    const updated = await a1.tools.get('session_tags_library_update').execute({
      create: [{ name: '新库标签', color: '#8fd694' }],
      rename: [{ from: '发布', to: '已发布' }],
      delete: ['不存在'],
    }, exec)
    assert.deepEqual(updated.notes, ['delete skipped: no tag named "不存在"'])
    assert.deepEqual(updated.library.map(tag => tag.name).sort(), ['已发布', '报税', '新库标签'])

    // The assignment follows renames because tags are referenced by id.
    const reread = await a1.tools.get('session_tags_get').execute({}, exec)
    assert.deepEqual(reread.tags.map(tag => tag.name).sort(), ['已发布', '报税'])

    // The UI state reflects everything the model did.
    const state = await call(plugin.base, '/state')
    assert.equal(state.libraries['ws-1'].tags.length, 3)
    assert.equal(state.sessions.s1.tagIds.length, 2)

    // Workspace isolation: ws-2's agent sees an empty library.
    const b1 = makeAgent('s3')
    await call(plugin.base, '/agent-tools', { method: 'POST', body: { workspaceKey: 'ws-2', enabled: true } })
    plugin.agents.push(b1)
    await plugin.emit('agent/created', { agent: b1 })
    const other = await b1.tools.get('session_tags_library_list').execute({}, { agent: b1 })
    assert.deepEqual(other.library, [])
    const otherGot = await b1.tools.get('session_tags_get').execute({}, { agent: b1 })
    assert.deepEqual(otherGot.tags, [])

    await assert.rejects(() => a1.tools.get('session_tags_library_update').execute({}, exec), /at least one/)
    await assert.rejects(() => a1.tools.get('session_tags_set').execute({}, exec), /"tags" array/)
  } finally {
    await plugin.close()
  }
})

test('disposing removes both the route and the event listeners', async () => {
  const plugin = await startPlugin()
  await plugin.close()
  await assert.rejects(() => fetch(plugin.base + '/state'))
})
