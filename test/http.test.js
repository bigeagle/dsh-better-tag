import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { createStore, PALETTE } from '../src/store.js'
import { registerLocalApi } from '../src/http.js'

const logger = { warn: () => {} }

const WORKSPACES = [
  { key: 'ws-a', title: 'Alpha', sessionIds: ['s1', 's2'] },
  { key: 'ws-b', title: 'Beta', sessionIds: ['s3'] },
]

async function withServer (run, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'better-tag-http-'))
  const store = createStore({ dir, log: logger })
  await store.ready
  const server = http.createServer()
  const agentToolsCalls = []
  const dispose = registerLocalApi({
    webServer: { register (route) { server.on('request', route.handler); return () => {} } },
    store,
    log: logger,
    path: '/better-tag',
    resolveKey: sessionId => (WORKSPACES.find(ws => ws.sessionIds.includes(sessionId))?.key ?? 'ungrouped'),
    workspaces: () => WORKSPACES,
    onAgentTools: (key, enabled) => { agentToolsCalls.push([key, enabled]) },
    ...options,
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/better-tag`
  try {
    await run({ base, store, agentToolsCalls })
  } finally {
    dispose()
    await new Promise(resolve => server.close(resolve))
  }
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
  return { status: response.status, json: await response.json() }
}

test('serves state with libraries for every workspace and rejects writes without the custom header', async () => {
  await withServer(async ({ base }) => {
    const state = await call(base, '/state')
    assert.equal(state.status, 200)
    assert.equal(state.json.version, 1)
    assert.deepEqual(Object.keys(state.json.libraries).sort(), ['ws-a', 'ws-b'])
    assert.deepEqual(state.json.sessionWorkspaces, { s1: 'ws-a', s2: 'ws-a', s3: 'ws-b' })
    assert.deepEqual(state.json.workspaces, [
      { key: 'ws-a', title: 'Alpha' },
      { key: 'ws-b', title: 'Beta' },
    ])

    const denied = await fetch(base + '/tags', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    })
    assert.equal(denied.status, 403)
  })
})

test('tag writes route by sessionId or explicit workspaceKey', async () => {
  await withServer(async ({ base }) => {
    const created = await call(base, '/tags', { method: 'POST', body: { sessionId: 's1', name: '报税' } })
    assert.equal(created.status, 200)
    assert.equal(created.json.libraries['ws-a'].tags.length, 1)
    assert.equal(created.json.libraries['ws-b'], undefined)

    const tagId = created.json.tag.id
    const other = await call(base, '/tags', { method: 'POST', body: { workspaceKey: 'ws-b', name: '发布' } })
    assert.equal(other.json.libraries['ws-b'].tags.length, 1)

    const renamed = await call(base, '/tags/update', { method: 'POST', body: { workspaceKey: 'ws-a', id: tagId, name: '税务' } })
    assert.equal(renamed.json.libraries['ws-a'].tags[0].name, '税务')

    // The same id does not exist in ws-b: 404, and ws-a stays untouched.
    const missing = await call(base, '/tags/update', { method: 'POST', body: { workspaceKey: 'ws-b', id: tagId, name: 'x' } })
    assert.equal(missing.status, 404)

    const removed = await call(base, '/tags/delete', { method: 'POST', body: { sessionId: 's2', id: tagId } })
    assert.equal(removed.status, 200)
    assert.equal(removed.json.libraries['ws-a'].tags.length, 0)
  })
})

test('session writes validate tags against the resolved workspace library', async () => {
  await withServer(async ({ base }) => {
    const a = await call(base, '/tags', { method: 'POST', body: { workspaceKey: 'ws-a', name: 'a' } })
    const b = await call(base, '/tags', { method: 'POST', body: { workspaceKey: 'ws-b', name: 'b' } })
    const state = await call(base, '/session', {
      method: 'POST',
      body: { sessionId: 's1', tagIds: [a.json.tag.id, b.json.tag.id], done: true },
    })
    assert.equal(state.status, 200)
    assert.deepEqual(state.json.sessions.s1.tagIds, [a.json.tag.id])
    assert.equal(state.json.sessions.s1.done, true)
  })
})

test('agent-tools route flips the switch and notifies the host', async () => {
  await withServer(async ({ base, agentToolsCalls }) => {
    const on = await call(base, '/agent-tools', { method: 'POST', body: { workspaceKey: 'ws-a', enabled: true } })
    assert.equal(on.status, 200)
    assert.equal(on.json.libraries['ws-a'].agentTools, true)
    assert.deepEqual(agentToolsCalls, [['ws-a', true]])

    const off = await call(base, '/agent-tools', { method: 'POST', body: { sessionId: 's3', enabled: false } })
    assert.equal(off.json.libraries['ws-b'].agentTools, false)
    assert.deepEqual(agentToolsCalls, [['ws-a', true], ['ws-b', false]])
  })
})

test('export and import address one workspace library', async () => {
  await withServer(async ({ base }) => {
    await call(base, '/tags', { method: 'POST', body: { workspaceKey: 'ws-a', name: '报税', color: '#8fd694' } })

    const pack = await call(base, '/export?workspace=ws-a')
    assert.deepEqual(pack.json.pack.tags, [{ name: '报税', color: '#8fd694' }])
    const viaSession = await call(base, '/export?session=s3')
    assert.deepEqual(viaSession.json.pack.tags, [])

    const imported = await call(base, '/import', {
      method: 'POST',
      body: { workspaceKey: 'ws-b', pack: { tags: [{ name: '发布', color: '#f0a35e' }] } },
    })
    assert.deepEqual(imported.json.report.added, ['发布'])
    assert.equal(imported.json.libraries['ws-b'].tags.length, 1)
    assert.equal(imported.json.libraries['ws-a'].tags.length, 1)
  })
})

test('a new tag without a color picks one from the palette', async () => {
  await withServer(async ({ base }) => {
    const first = await call(base, '/tags', { method: 'POST', body: { workspaceKey: 'ws-a', name: 'a' } })
    assert.ok(PALETTE.includes(first.json.tag.color))
  })
})

test('the events long-poll answers immediately when behind and holds until a write', async () => {
  await withServer(async ({ base }) => {
    // Behind the store version: answers at once with the full snapshot.
    const behind = await call(base, '/events?since=0')
    assert.equal(behind.status, 200)
    assert.equal(behind.json.changed, true)
    assert.deepEqual(behind.json.libraries['ws-a'], { tags: [], agentTools: false })
    assert.deepEqual(behind.json.sessionWorkspaces, { s1: 'ws-a', s2: 'ws-a', s3: 'ws-b' })
    const version = behind.json.version

    // At the current version: the request holds until a write lands.
    const held = call(base, `/events?since=${version}`)
    await new Promise(resolve => setTimeout(resolve, 50))
    await call(base, '/tags', { method: 'POST', body: { workspaceKey: 'ws-a', name: '推送' } })
    const woken = await held
    assert.equal(woken.json.changed, true)
    assert.equal(woken.json.libraries['ws-a'].tags[0].name, '推送')

    // No write within the hold window: a clean changed:false. The hold must
    // comfortably exceed request latency under a loaded test runner, where a
    // loopback POST has been observed taking >250ms.
    const idle = await call(base, `/events?since=${woken.json.version}`)
    assert.equal(idle.json.changed, false)
  }, { eventsHoldMs: 1500 })
})

test('reports version conflicts as 409 and unknown routes as 404', async () => {
  await withServer(async ({ base }) => {
    await call(base, '/tags', { method: 'POST', body: { workspaceKey: 'ws-a', name: 'x' } })
    const conflict = await call(base, '/session', {
      method: 'POST',
      body: { sessionId: 's1', tagIds: [], ifVersion: 1 },
    })
    assert.equal(conflict.status, 409)

    const missing = await call(base, '/nope')
    assert.equal(missing.status, 404)
  })
})
