import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createStore, PALETTE, UNGROUPED } from '../src/store.js'

const logger = { warn: () => {} }

async function tempStore (options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'better-tag-store-'))
  const store = createStore({ dir, log: logger, ...options })
  await store.ready
  return { dir, store }
}

test('subscribe fires on every committed mutation and unsubscribes cleanly', async () => {
  const { store } = await tempStore()
  let fired = 0
  const dispose = store.subscribe(() => { fired += 1 })

  const { tag } = await store.createTag({ libraryKey: 'ws-a', name: 'a' })
  assert.equal(fired, 1)
  await store.setSession({ sessionId: 's1', libraryKey: 'ws-a', tagIds: [tag.id] })
  assert.equal(fired, 2)
  // A no-op write persists nothing and stays silent.
  assert.equal(await store.copyTags('missing', 's9', 'ws-a'), false)
  assert.equal(fired, 2)

  dispose()
  await store.setAgentTools({ libraryKey: 'ws-a', enabled: true })
  assert.equal(fired, 2)
})

test('starts empty and persists a session record across restart', async () => {
  const { dir, store } = await tempStore()
  assert.deepEqual(store.state(), { version: 1, libraries: {}, sessions: {} })

  const { tag } = await store.createTag({ libraryKey: 'ws-a', name: '报税', color: '#8fd694' })
  await store.setSession({ sessionId: 'session-a', libraryKey: 'ws-a', tagIds: [tag.id] })

  const reopened = createStore({ dir, log: logger })
  await reopened.ready
  const state = reopened.state()
  assert.equal(state.libraries['ws-a'].tags.length, 1)
  assert.equal(state.libraries['ws-a'].tags[0].name, '报税')
  assert.deepEqual(state.sessions['session-a'].tagIds, [tag.id])
})

test('a v1 global document migrates: tags become the seed of every new library', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'better-tag-store-'))
  await fs.writeFile(path.join(dir, 'state.json'), JSON.stringify({
    version: 7,
    tags: [{ id: 'tag-1', name: '报税', color: '#8fd694', order: 0, createdAt: 1 }],
    sessions: { 'session-a': { sessionId: 'session-a', tagIds: ['tag-1'], inlineTags: [], done: true, updatedAt: 1 } }, // legacy done field is dropped
  }), 'utf8')
  const store = createStore({ dir, log: logger })
  await store.ready
  // Nothing materializes until a workspace key is touched.
  assert.deepEqual(store.state().libraries, {})
  assert.deepEqual(store.state().sessions['session-a'].tagIds, ['tag-1'])
  // The retired done stamp does not survive normalization.
  assert.equal(store.state().sessions['session-a'].done, undefined)

  const state = await store.ensureLibraries(['ws-a', 'ws-b'])
  assert.equal(state.libraries['ws-a'].tags[0].id, 'tag-1')
  assert.equal(state.libraries['ws-b'].tags[0].name, '报税')
  assert.equal(state.libraries['ws-a'].agentTools, false)

  // Each copy evolves independently.
  await store.updateTag({ libraryKey: 'ws-a', id: 'tag-1', name: '税务' })
  const after = store.state()
  assert.equal(after.libraries['ws-a'].tags[0].name, '税务')
  assert.equal(after.libraries['ws-b'].tags[0].name, '报税')

  // The seed survives restart, so later workspaces still start from it.
  const reopened = createStore({ dir, log: logger })
  await reopened.ready
  const reseeded = await reopened.ensureLibraries(['ws-c'])
  assert.equal(reseeded.libraries['ws-c'].tags[0].id, 'tag-1')
})

test('libraries are isolated per workspace and reject duplicates case-insensitively', async () => {
  const { store } = await tempStore()
  await store.createTag({ libraryKey: 'ws-a', name: 'Report', color: '#7c9cff' })
  await assert.rejects(() => store.createTag({ libraryKey: 'ws-a', name: ' report ', color: '#7c9cff' }), /already exists/)
  // The same name in another workspace is a different tag.
  const { tag } = await store.createTag({ libraryKey: 'ws-b', name: 'report' })
  assert.equal(store.state().libraries['ws-b'].tags[0].id, tag.id)
})

test('setSession validates tagIds against the session workspace library', async () => {
  const { store } = await tempStore()
  const { tag: a } = await store.createTag({ libraryKey: 'ws-a', name: 'a' })
  const { tag: b } = await store.createTag({ libraryKey: 'ws-b', name: 'b' })
  const state = await store.setSession({ sessionId: 's1', libraryKey: 'ws-a', tagIds: [a.id, b.id] })
  assert.deepEqual(state.sessions.s1.tagIds, [a.id])
})

test('deleting a tag cascades into every session', async () => {
  const { store } = await tempStore()
  const { tag: a } = await store.createTag({ libraryKey: 'ws-a', name: 'a', color: '#7c9cff' })
  const { tag: b } = await store.createTag({ libraryKey: 'ws-a', name: 'b', color: '#f0a35e' })
  await store.setSession({ sessionId: 's1', libraryKey: 'ws-a', tagIds: [a.id, b.id] })
  await store.setSession({ sessionId: 's2', libraryKey: 'ws-a', tagIds: [b.id] })

  const next = await store.deleteTag({ libraryKey: 'ws-a', id: b.id })
  assert.equal(next.libraries['ws-a'].tags.length, 1)
  assert.deepEqual(next.sessions.s1.tagIds, [a.id])
  assert.deepEqual(next.sessions.s2.tagIds, [])
})

test('version conflicts refuse the write', async () => {
  const { store } = await tempStore()
  await store.createTag({ libraryKey: 'ws-a', name: 'x' })
  await assert.rejects(
    () => store.setSession({ sessionId: 's1', libraryKey: 'ws-a', tagIds: [], ifVersion: 1 }),
    /expected version/,
  )
})

test('import merges by name into one library and reports conflicts without touching local color', async () => {
  const { store } = await tempStore()
  await store.createTag({ libraryKey: 'ws-a', name: '报税', color: '#8fd694' })
  const { report, state } = await store.importPack({
    libraryKey: 'ws-a',
    pack: { tags: [{ name: '报税', color: '#7c9cff' }, { name: '发布', color: '#f0a35e' }] },
  })
  assert.deepEqual(report.added, ['发布'])
  assert.deepEqual(report.conflicts, [{ name: '报税', local: '#8fd694', incoming: '#7c9cff' }])
  assert.equal(state.libraries['ws-a'].tags.length, 2)
  assert.equal(state.libraries['ws-a'].tags[0].color, '#8fd694')
})

test('export and import address one workspace library', async () => {
  const { store } = await tempStore()
  await store.createTag({ libraryKey: 'ws-a', name: '报税', color: '#8fd694' })
  const pack = await store.exportPack('ws-a')
  assert.equal(pack.kind, 'dsh-better-tag-pack')
  assert.deepEqual(pack.tags, [{ name: '报税', color: '#8fd694' }])
  assert.deepEqual((await store.exportPack('ws-b')).tags, [])
})

test('agentTools defaults off, flips per library, and persists', async () => {
  const { dir, store } = await tempStore()
  assert.equal(await store.agentToolsEnabled('ws-a'), false)
  await store.setAgentTools({ libraryKey: 'ws-a', enabled: true })
  assert.equal(await store.agentToolsEnabled('ws-a'), true)
  assert.equal(await store.agentToolsEnabled('ws-b'), false)

  const reopened = createStore({ dir, log: logger })
  await reopened.ready
  assert.equal(await reopened.agentToolsEnabled('ws-a'), true)
})

test('editLibrary applies create, rename, recolor, delete in order and reports skips', async () => {
  const { store } = await tempStore()
  await store.createTag({ libraryKey: 'ws-a', name: '旧名', color: '#8fd694' })
  const { notes, state } = await store.editLibrary({
    libraryKey: 'ws-a',
    create: [{ name: '新标签' }, { name: '旧名' }],
    rename: [{ from: '旧名', to: '改名后' }, { from: '不存在', to: 'x' }],
    recolor: [{ name: '改名后', color: '#f07a7a' }, { name: '改名后 ', color: 'red' }],
    remove: ['新标签', '也没有'],
  })
  const names = state.libraries['ws-a'].tags.map(tag => [tag.name, tag.color])
  assert.deepEqual(names, [['改名后', '#f07a7a']])
  assert.deepEqual(notes, [
    'create skipped: "旧名" already exists',
    'rename skipped: no tag named "不存在"',
    'recolor skipped: "改名后" needs a #rrggbb color',
    'delete skipped: no tag named "也没有"',
  ])
})

test('assignByNames sets the session tags, creating unknown names', async () => {
  const { store } = await tempStore()
  await store.createTag({ libraryKey: 'ws-a', name: '报税', color: '#8fd694' })
  const { assigned, created } = await store.assignByNames({ sessionId: 's1', libraryKey: 'ws-a', names: ['报税', '新活'] })
  assert.equal(created, true)
  assert.deepEqual(assigned.map(tag => tag.name), ['报税', '新活'])
  const state = store.state()
  assert.equal(state.libraries['ws-a'].tags.length, 2)
  assert.equal(state.sessions.s1.tagIds.length, 2)
  // Colors come from the palette.
  assert.ok(PALETTE.includes(assigned[1].color))

  const cleared = await store.assignByNames({ sessionId: 's1', libraryKey: 'ws-a', names: [] })
  assert.deepEqual(cleared.assigned, [])
  assert.deepEqual(store.state().sessions.s1.tagIds, [])
})

test('assignByNames rejects a bad name without leaving created tags behind', async () => {
  const { store } = await tempStore()
  await assert.rejects(
    () => store.assignByNames({ sessionId: 's1', libraryKey: 'ws-a', names: ['好的', 'x'.repeat(20)] }),
    /tag name must be/,
  )
  assert.deepEqual(store.state().libraries['ws-a']?.tags ?? [], [])
  assert.equal(store.state().sessions.s1, undefined)
})

test('inline tags persist, dedupe, cap at eight, and never enter the library', async () => {
  const { store } = await tempStore()
  const inlineTags = [
    ...Array.from({ length: 10 }, (_, i) => ({ name: `临时${i}` })),
    { name: '临时0' },
  ]
  const state = await store.setSession({ sessionId: 's1', libraryKey: 'ws-a', inlineTags })
  assert.equal(state.sessions.s1.inlineTags.length, 8)
  assert.deepEqual(state.libraries['ws-a']?.tags ?? [], [])
  for (const tag of state.sessions.s1.inlineTags) assert.ok(PALETTE.includes(tag.color))

  const reopenedState = await store.setSession({ sessionId: 's1', inlineTags: state.sessions.s1.inlineTags })
  assert.equal(reopenedState.sessions.s1.inlineTags.length, 8)
})

test('fork copies inline tags, resolving against the library', async () => {
  const { store } = await tempStore()
  const { tag } = await store.createTag({ libraryKey: 'ws-a', name: 'a', color: '#7c9cff' })
  const { tag: foreign } = await store.createTag({ libraryKey: 'ws-b', name: 'b', color: '#f0a35e' })
  await store.setSession({
    sessionId: 'parent',
    libraryKey: 'ws-a',
    tagIds: [tag.id, foreign.id],
    inlineTags: [{ name: '临时', color: '#67c98a' }],
  })
  assert.equal(await store.copyTags('parent', 'child', 'ws-a'), true)
  const child = store.state().sessions.child
  assert.deepEqual(child.tagIds, [tag.id])
  assert.deepEqual(child.inlineTags, [{ name: '临时', color: '#67c98a' }])
})

test('inheritFork resolves the library key and skips subagent children', async () => {
  const { store } = await tempStore()
  const { tag } = await store.createTag({ libraryKey: 'ws-a', name: 'a' })
  await store.setSession({ sessionId: 'parent', libraryKey: 'ws-a', tagIds: [tag.id] })

  const subagent = { id: 'child-sub', header: { isSeeded: true, origin: 'subagent' } }
  assert.equal(await store.inheritFork(subagent, () => [], () => 'ws-a'), false)

  const child = { id: 'child', header: { isSeeded: true, parentSession: 'parent' } }
  const keys = []
  assert.equal(await store.inheritFork(child, () => [], id => { keys.push(id); return 'ws-a' }), true)
  assert.deepEqual(keys, ['child'])
  assert.deepEqual(store.state().sessions.child.tagIds, [tag.id])
})

test('inheritFork falls back to first-event matching when the child has no parent link', async () => {
  const { store } = await tempStore()
  const { tag } = await store.createTag({ libraryKey: 'ws-a', name: 'a' })
  await store.setSession({ sessionId: 'parent', libraryKey: 'ws-a', tagIds: [tag.id] })

  const first = { seq: 0, type: 'x' }
  const parent = { id: 'parent', events: [first, { seq: 1 }] }
  const child = { id: 'child', header: { isSeeded: true }, events: [first] }
  assert.equal(await store.inheritFork(child, () => [child, parent], () => UNGROUPED), true)
  // The parent record's tagIds do not resolve in the ungrouped library.
  assert.deepEqual(store.state().sessions.child.tagIds, [])
})

test('a new tag without a color takes the least-used palette slot', async () => {
  const { store } = await tempStore({ rng: () => 0 })
  const { tag: first } = await store.createTag({ libraryKey: 'ws-a', name: 'a' })
  assert.equal(first.color, PALETTE[0])
  const { tag: second } = await store.createTag({ libraryKey: 'ws-a', name: 'b' })
  assert.equal(second.color, PALETTE[1])
  // Another workspace starts from its own untouched palette.
  const { tag: other } = await store.createTag({ libraryKey: 'ws-b', name: 'a' })
  assert.equal(other.color, PALETTE[0])
})
