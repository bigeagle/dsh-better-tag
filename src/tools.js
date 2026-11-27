/**
 * Model-facing tag tools.
 *
 * Four raw JSON-schema tools in two scopes: `tag_library_*` reads and edits
 * the workspace's shared tag library, `session_tags_*` reads and replaces the
 * calling session's own tags. They are not registered globally: the host half
 * attaches them to an agent's scoped context only while that agent's
 * workspace has the model-tools switch on, so an agent in a workspace without
 * the switch never sees them.
 *
 * Every tool resolves the calling agent's workspace through `resolveKey` at
 * execute time, so a session that moves workspaces follows its new library.
 */

const TAG_NAME = { type: 'string', description: 'Tag name, 1-16 characters. Names match case-insensitively.' }
const TAG_COLOR = { type: 'string', description: 'Color as #rrggbb. Omit to pick a palette color.' }

const LIBRARY_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: { name: { type: 'string' }, color: { type: 'string' } },
    required: ['name', 'color'],
  },
}

/** Throw a model-correctable failure when one argument is not a string array. */
function stringArray (args, field) {
  const value = args[field]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`"${field}" must be an array of strings`)
  }
  return value
}

/** Throw a model-correctable failure when one argument is not an object array. */
function objectArray (args, field) {
  const value = args[field]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(item => item === null || typeof item !== 'object' || Array.isArray(item))) {
    throw new Error(`"${field}" must be an array of objects`)
  }
  return value
}

/** Render one library as a compact name list for the model. */
function libraryLine (library) {
  if (library.length === 0) return 'The workspace tag library is empty.'
  return `Library (${library.length}): ${library.map(tag => tag.name).join(', ')}`
}

function libraryOf (state, key) {
  return state.libraries[key]?.tags ?? []
}

/**
 * Build the four tag tool definitions.
 * @param {{ store: object, resolveKey: (sessionId: string) => string, log?: object }} options - dependencies.
 * @returns raw tool definitions for `ctx.tools.register`.
 */
export function createTagTools ({ store, resolveKey, log = console }) {
  /** The calling agent's session id and library key, or a model-correctable failure. */
  const targetOf = (tool, exec) => {
    const agent = exec?.agent
    if (agent === undefined || agent === null) {
      throw new Error(`${tool} requires an owning agent session`)
    }
    const sessionId = String(agent.id)
    return { sessionId, key: resolveKey(sessionId) }
  }

  const libraryListTool = {
    name: 'session_tags_library_list',
    description:
      "List the current workspace's tag library: every shared tag with its color. Tags are short colored "
      + 'labels for organizing sessions; every workspace has its own library. Use session_tags_get for the '
      + 'tags on this session.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { library: LIBRARY_SCHEMA },
        required: ['library'],
      },
      render: (_args, value) => [{ type: 'text', text: libraryLine(value.library) }],
    },
    async execute (_args, exec) {
      const { key } = targetOf('session_tags_library_list', exec)
      await store.ensureLibraries([key])
      return { library: libraryOf(store.state(), key).map(tag => ({ name: tag.name, color: tag.color })) }
    },
    presentCall: () => ({ card: 'generic', title: 'List tag library', kind: 'search' }),
  }

  const sessionGetTool = {
    name: 'session_tags_get',
    description:
      'Read the tags assigned to the current session, with their colors. '
      + "Use session_tags_library_list for the workspace's full tag vocabulary.",
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { tags: LIBRARY_SCHEMA },
        required: ['tags'],
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.tags.length > 0
          ? `This session's tags: ${value.tags.map(tag => tag.name).join(', ')}`
          : 'This session has no tags.',
      }],
    },
    async execute (_args, exec) {
      const { sessionId, key } = targetOf('session_tags_get', exec)
      const state = store.state()
      const library = libraryOf(state, key)
      const tags = (state.sessions[sessionId]?.tagIds ?? [])
        .map(id => library.find(tag => tag.id === id))
        .filter(Boolean)
        .map(tag => ({ name: tag.name, color: tag.color }))
      return { tags }
    },
    presentCall: () => ({ card: 'generic', title: 'Read session tags', kind: 'search' }),
  }

  const updateTool = {
    name: 'session_tags_library_update',
    description:
      "Edit the current workspace's tag library: create tags, rename or recolor existing ones, or delete them. "
      + 'Deleting a tag removes it from every session carrying it. Operations apply in order create, rename, '
      + 'recolor, delete; skipped operations are reported in notes. Use session_tags_set to change which tags the '
      + 'current session carries.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        create: {
          type: 'array',
          description: 'Tags to add to the library.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: { name: TAG_NAME, color: TAG_COLOR },
            required: ['name'],
          },
        },
        rename: {
          type: 'array',
          description: 'Renames of existing library tags.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: { from: { type: 'string', description: 'Current name.' }, to: TAG_NAME },
            required: ['from', 'to'],
          },
        },
        recolor: {
          type: 'array',
          description: 'Color changes of existing library tags.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: { name: TAG_NAME, color: { type: 'string', description: 'New color as #rrggbb.' } },
            required: ['name', 'color'],
          },
        },
        delete: { type: 'array', description: 'Names of library tags to delete.', items: { type: 'string' } },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { library: LIBRARY_SCHEMA, notes: { type: 'array', items: { type: 'string' } } },
        required: ['library', 'notes'],
      },
      render: (_args, value) => {
        const lines = [libraryLine(value.library)]
        for (const note of value.notes) lines.push(`note: ${note}`)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute (args, exec) {
      const { key } = targetOf('session_tags_library_update', exec)
      const input = args !== null && typeof args === 'object' ? args : {}
      const create = objectArray(input, 'create')
      const rename = objectArray(input, 'rename')
      const recolor = objectArray(input, 'recolor')
      const remove = stringArray(input, 'delete')
      if ([create, rename, recolor, remove].every(batch => batch === undefined || batch.length === 0)) {
        throw new Error('session_tags_library_update needs at least one of "create", "rename", "recolor", or "delete"')
      }
      const { notes, state } = await store.editLibrary({ libraryKey: key, create, rename, recolor, remove })
      return { library: libraryOf(state, key).map(tag => ({ name: tag.name, color: tag.color })), notes }
    },
    presentCall: () => ({ card: 'generic', title: 'Update tag library', kind: 'other' }),
  }

  const setTool = {
    name: 'session_tags_set',
    description:
      "Replace the current session's library tags with exactly the given names. Names missing from the "
      + 'workspace tag library are created automatically. Pass an empty array to remove all library tags. '
      + 'Session-only temporary tags are not affected.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        tags: {
          type: 'array',
          description: 'The complete set of tag names for this session; [] clears all library tags.',
          items: TAG_NAME,
        },
      },
      required: ['tags'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { assigned: LIBRARY_SCHEMA },
        required: ['assigned'],
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.assigned.length > 0
          ? `Session tags set to: ${value.assigned.map(tag => tag.name).join(', ')}`
          : 'Session tags cleared.',
      }],
    },
    async execute (args, exec) {
      const { sessionId, key } = targetOf('session_tags_set', exec)
      const tags = stringArray(args !== null && typeof args === 'object' ? args : {}, 'tags')
      if (tags === undefined) throw new Error('session_tags_set needs a "tags" array of tag names')
      const { assigned } = await store.assignByNames({ sessionId, libraryKey: key, names: tags })
      return { assigned }
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Set session tags',
      kind: 'other',
      rawInput: Array.isArray(args?.tags) ? args.tags.join(', ') : undefined,
    }),
  }

  return [libraryListTool, updateTool, sessionGetTool, setTool]
}
