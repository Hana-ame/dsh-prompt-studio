/**
 * dsh-prompt-studio — preset authoring host half.
 *
 * The GUI 「预设」 panel edits AGENT PRESETS themselves (not a session
 * overlay): each preset's persona prefix/suffix and display metadata are
 * written back into the active profile's patch (comment-preserving YAML via
 * the `yaml` document API), and the live HMR reconcile re-registers the
 * preset, so new sessions pick up the new system prompt.
 *
 * Routes:
 *   GET  /preset-studio/list
 *        -> { patchPath, presets: [{ id, name, description, order, broken?,
 *                                   personaPrefix, personaSuffix,
 *                                   source: 'profile-patch'|'bundle' }] }
 *   POST /preset-studio/save   { id, name?, description?, order?,
 *                                personaPrefix?, personaSuffix? }
 *        Edit the preset row already in the profile patch; or, for a preset
 *        defined by a bundle, append a complete override row cloned from the
 *        composed configuration (loader: later row wins by id).
 *   POST /preset-studio/create { id, name, description?, order?, baseId?,
 *                                personaPrefix?, personaSuffix? }
 *        Append a new preset row cloned from `baseId` (default: standard).
 *
 * A `!!js` tag is preserved on round-trip and produced when a composed value
 * carries an `__jsExpr` wrapper (platform-conditional tool rows).
 *
 * @module dsh-prompt-studio/presets
 */

import { createRequire } from 'node:module'
import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import YAML from 'yaml'

export const name = 'preset-studio'

/** Host services used: the HTTP carrier and its auth gate. */
export const inject = ['webServer', 'connection']

/** `!!js` tag the loader's entry-list dialect uses for expression scalars. */
const JS_TAG = 'tag:yaml.org,2002:js'
const JS_TAG_DEF = [{ tag: JS_TAG, resolve: (value) => value }]

/** Names of the preset child row that carries the system prompt. */
const PERSONA_ROW_ID = 'persona'
const PERSONA_PLUGIN_NAME = '@deepseek-ai/dsh-persona'

/** The row that declares a preset. */
const PRESET_ROW_NAME = '@deepseek-ai/dsh-agent-preset'

/** JSON response helper. */
function respond(response, status, body) {
  const text = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  })
  response.end(text)
}

/** Request-body helper (empty body -> {}). */
async function readJsonBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.trim() === '') return {}
  return JSON.parse(raw)
}

/** Parse the profile patch as a comment-preserving YAML document. */
function parsePatch(text) {
  const doc = YAML.parseDocument(text, { customTags: JS_TAG_DEF })
  if (doc.errors.length > 0) throw new Error(`profile patch parse failed: ${doc.errors[0].message}`)
  if (!Array.isArray(doc.contents?.items)) throw new Error('profile patch must be a top-level YAML sequence')
  return doc
}

/** Node predicate guards for the YAML AST. */
const isMap = (node) => node instanceof YAML.YAMLMap
const isSeq = (node) => node instanceof YAML.YAMLSeq

/** Find the profile-patch row that declares preset `presetId`, if any. */
function findPresetRow(doc, presetId) {
  let fallback
  for (const item of doc.contents.items) {
    if (!isMap(item)) continue
    if (item.has('insert')) {
      const inserted = item.get('insert')
      if (!isSeq(inserted)) continue
      for (const child of inserted.items) {
        if (!isMap(child)) continue
        if (child.get('id') === `preset-${presetId}`) fallback = { row: child, kind: 'insert' }
      }
      continue
    }
    const id = item.get('id')
    if (typeof id === 'string' && id === `preset-${presetId}`) return { row: item, kind: 'root' }
  }
  return fallback
}

/** Escape a string for a regex comparison of preset ids. */
function validPresetId(id) {
  return typeof id === 'string' && /^[a-z][a-z0-9-]*$/.test(id)
}

/** Convert a composed config value into YAML nodes, restoring `!!js` tags. */
function valueToNode(doc, value) {
  if (value !== null && typeof value === 'object' && Object.keys(value).length === 1 && typeof value.__jsExpr === 'string') {
    const scalar = new YAML.Scalar(String(value.__jsExpr))
    scalar.tag = JS_TAG
    return scalar
  }
  if (Array.isArray(value)) {
    const seq = new YAML.YAMLSeq()
    seq.items = value.map((entry) => valueToNode(doc, entry))
    return seq
  }
  if (value !== null && typeof value === 'object') {
    const map = new YAML.YAMLMap()
    map.items = Object.entries(value).map(([key, entry]) => new YAML.Pair(key, valueToNode(doc, entry)))
    return map
  }
  return doc.createNode(value)
}

/** Read one composed preset config for a preset id (bundle or patch source). */
function composedConfigOf(req, profileDir, presetId) {
  const appBoot = req('@deepseek-ai/dsh-app-boot')
  const profile = appBoot.loadProfile('dsh', 'web', req.resolve('@deepseek-ai/dsh-app-boot/package.json'))
  const allPatches = [...profile.layers.map((layer) => layer.patches).flat(), ...profile.patches]
  const entries = appBoot.composeEntries([allPatches])
  const row = entries.find((entry) => entry?.name === PRESET_ROW_NAME && entry?.config?.id === presetId)
  return row?.config
}

/** Locate a persona row inside a composed (plain object) preset config. */
function personaOfComposed(config) {
  if (config === undefined || !Array.isArray(config.plugins)) return undefined
  return config.plugins.find((row) => row?.id === PERSONA_ROW_ID || row?.name === PERSONA_PLUGIN_NAME)
}

/** Locate a persona row inside a preset's `plugins` sequence. */
function personaRowOf(plugins, doc) {
  if (!isSeq(plugins)) return undefined
  return plugins.items.find((row) => isMap(row) && (row.get('id') === PERSONA_ROW_ID || row.get('name') === PERSONA_PLUGIN_NAME))
}

/** Set a scalar on a mapping, creating the mapping when absent. */
function setMapValue(mapNode, key, value) {
  if (value === undefined) return
  const existing = mapNode.get(key)
  if (existing !== undefined) {
    mapNode.set(key, value)
    return
  }
  mapNode.items.push(new YAML.Pair(key, value))
}

/** Ensure `row.config` is a mapping and set display metadata on it. */
function applyPresetMeta(row, meta) {
  let config = row.get('config')
  if (!isMap(config)) {
    config = new YAML.YAMLMap()
    row.set('config', config)
  }
  setMapValue(config, 'name', meta.name)
  setMapValue(config, 'description', meta.description)
  setMapValue(config, 'order', meta.order)
  return config
}

/** Write the preset's persona prefix/suffix into a config mapping. */
function applyPersona(config, doc, row, meta) {
  if (meta.personaPrefix === undefined && meta.personaSuffix === undefined) return
  let plugins = config.get('plugins')
  if (!isSeq(plugins)) {
    plugins = new YAML.YAMLSeq()
    config.set('plugins', plugins)
  }
  let persona = personaRowOf(plugins, doc)
  if (persona === undefined) {
    persona = doc.createNode({ id: PERSONA_ROW_ID, name: PERSONA_PLUGIN_NAME, config: {} })
    plugins.items.unshift(persona)
  }
  let personaConfig = persona.get('config')
  if (!isMap(personaConfig)) {
    personaConfig = new YAML.YAMLMap()
    persona.set('config', personaConfig)
  }
  setMapValue(personaConfig, 'prefix', meta.personaPrefix)
  setMapValue(personaConfig, 'suffix', meta.personaSuffix)
}

/** Resolve the profile patch path and its profile directory from Host state. */
function profileOf(ctx) {
  const profile = ctx.get('profileContext')
  if (profile === undefined || typeof profile.dir !== 'string') throw new Error('profileContext is unavailable; preset editing needs a profile deployment')
  return { dir: profile.dir, patchPath: profile.patchPath ?? join(profile.dir, 'cordis.patch.yml') }
}

/** Write the edited document atomically, keeping a timestamped backup. */
async function commitPatch(patchPath, text) {
  const backup = `${patchPath}.bak-preset-editor-${Date.now()}`
  const current = await readFile(patchPath, 'utf8')
  await writeFile(backup, current, 'utf8')
  const tmp = `${patchPath}.tmp-preset-editor-${process.pid}`
  await writeFile(tmp, text, 'utf8')
  await rename(tmp, patchPath)
}

/** Registry roster with composed values and patch-source classification. */
async function roster(ctx, req, profileDir) {
  const presets = ctx.get('agentPresets')
  if (presets === undefined) throw new Error('agentPresets service is unavailable')
  const listed = await presets.list()
  const patchText = await readFile(join(profileDir, 'cordis.patch.yml'), 'utf8')
  const doc = parsePatch(patchText)
  return {
    patchPath: join(profileDir, 'cordis.patch.yml'),
    presets: listed.map((entry) => {
      let composed
      try {
        composed = composedConfigOf(req, profileDir, entry.id)
      } catch {
        composed = undefined
      }
      const persona = personaOfComposed(composed)
      const found = findPresetRow(doc, entry.id)
      return {
        id: entry.id,
        name: entry.name ?? entry.id,
        description: entry.description ?? '',
        order: entry.order ?? null,
        ...(entry.broken === undefined ? {} : { broken: entry.broken }),
        personaPrefix: typeof persona?.config?.prefix === 'string' ? persona.config.prefix : '',
        personaSuffix: typeof persona?.config?.suffix === 'string' ? persona.config.suffix : '',
        source: found === undefined ? 'bundle' : 'profile-patch',
        rowKind: found?.kind ?? 'none',
      }
    }),
  }
}

/** Register the two preset-authoring routes. */
export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/preset-studio/list',
        handler: async (request, response) => {
          const rejection = ctx.connection.requestRejection?.(request)
          if (rejection !== undefined) return respond(response, rejection, { error: `auth rejected (HTTP ${String(rejection)})` })
          if (request.method !== 'GET') return respond(response, 405, { error: 'GET required' })
          try {
            const { dir } = profileOf(ctx)
            const req = createRequire(join(dir, 'package.json'))
            const data = await roster(ctx, req, dir)
            return respond(response, 200, data)
          } catch (error) {
            return respond(response, 500, { error: `listing presets failed: ${error?.message ?? error}` })
          }
        },
      }),
    'preset-studio: list route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/preset-studio/save',
        handler: async (request, response) => {
          const rejection = ctx.connection.requestRejection?.(request)
          if (rejection !== undefined) return respond(response, rejection, { error: `auth rejected (HTTP ${String(rejection)})` })
          if (request.method !== 'POST') return respond(response, 405, { error: 'POST required' })
          let payload
          try {
            payload = await readJsonBody(request)
          } catch (error) {
            return respond(response, 400, { error: `invalid JSON: ${String(error)}` })
          }
          const presetId = payload?.id
          if (!validPresetId(presetId)) return respond(response, 400, { error: 'a valid preset id is required' })
          try {
            const { dir, patchPath } = profileOf(ctx)
            const req = createRequire(join(dir, 'package.json'))
            const doc = parsePatch(await readFile(patchPath, 'utf8'))
            const meta = {
              name: typeof payload.name === 'string' ? payload.name : undefined,
              description: typeof payload.description === 'string' ? payload.description : undefined,
              order: Number.isFinite(payload.order) ? payload.order : undefined,
              personaPrefix: typeof payload.personaPrefix === 'string' ? payload.personaPrefix : undefined,
              personaSuffix: typeof payload.personaSuffix === 'string' ? payload.personaSuffix : undefined,
            }
            const found = findPresetRow(doc, presetId)
            if (found !== undefined) {
              const config = applyPresetMeta(found.row, meta)
              applyPersona(config, doc, found.row, meta)
            } else {
              const composed = composedConfigOf(req, dir, presetId)
              if (composed === undefined) return respond(response, 404, { error: `preset "${presetId}" is not defined in this deployment` })
              const config = structuredClone(composed)
              if (meta.name !== undefined) config.name = meta.name
              if (meta.description !== undefined) config.description = meta.description
              if (meta.order !== undefined) config.order = meta.order
              const persona = Array.isArray(config.plugins) ? config.plugins.find((row) => row?.id === PERSONA_ROW_ID || row?.name === PERSONA_PLUGIN_NAME) : undefined
              if (meta.personaPrefix !== undefined || meta.personaSuffix !== undefined) {
                if (persona === undefined) config.plugins = [{ id: PERSONA_ROW_ID, name: PERSONA_PLUGIN_NAME, config: {} }, ...(config.plugins ?? [])]
                const target = config.plugins.find((row) => row?.id === PERSONA_ROW_ID || row?.name === PERSONA_PLUGIN_NAME)
                target.config = { ...(target.config ?? {}) }
                if (meta.personaPrefix !== undefined) target.config.prefix = meta.personaPrefix
                if (meta.personaSuffix !== undefined) target.config.suffix = meta.personaSuffix
              }
              const converted = valueToNode(doc, { id: `preset-${presetId}`, name: PRESET_ROW_NAME, config })
              doc.contents.items.push(converted)
            }
            await commitPatch(patchPath, String(doc))
            return respond(response, 200, {
              ok: true,
              presetId,
              patchPath,
              note: 'saved to the profile patch; the live reload re-registers the preset. New sessions use it — open sessions keep their mounted composition.',
            })
          } catch (error) {
            return respond(response, 500, { error: `saving preset failed: ${error?.message ?? error}` })
          }
        },
      }),
    'preset-studio: save route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/preset-studio/create',
        handler: async (request, response) => {
          const rejection = ctx.connection.requestRejection?.(request)
          if (rejection !== undefined) return respond(response, rejection, { error: `auth rejected (HTTP ${String(rejection)})` })
          if (request.method !== 'POST') return respond(response, 405, { error: 'POST required' })
          let payload
          try {
            payload = await readJsonBody(request)
          } catch (error) {
            return respond(response, 400, { error: `invalid JSON: ${String(error)}` })
          }
          const presetId = payload?.id
          if (!validPresetId(presetId)) return respond(response, 400, { error: 'a valid preset id is required (lowercase letters, digits, dashes)' })
          try {
            const { dir, patchPath } = profileOf(ctx)
            const req = createRequire(join(dir, 'package.json'))
            const presets = ctx.get('agentPresets')
            const listed = presets === undefined ? [] : await presets.list()
            if (listed.some((entry) => entry.id === presetId)) return respond(response, 409, { error: `preset "${presetId}" already exists` })
            const doc = parsePatch(await readFile(patchPath, 'utf8'))
            if (findPresetRow(doc, presetId) !== undefined) return respond(response, 409, { error: `a preset row for "${presetId}" already exists in the profile patch` })
            const baseId = typeof payload?.baseId === 'string' && payload.baseId.length > 0 ? payload.baseId : 'standard'
            const composed = composedConfigOf(req, dir, baseId)
            if (composed === undefined) return respond(response, 404, { error: `base preset "${baseId}" is not defined in this deployment` })
            const config = structuredClone(composed)
            config.id = presetId
            config.name = typeof payload?.name === 'string' && payload.name.length > 0 ? payload.name : presetId
            if (typeof payload?.description === 'string') config.description = payload.description
            if (Number.isFinite(payload?.order)) config.order = payload.order
            const persona = Array.isArray(config.plugins) ? config.plugins.find((row) => row?.id === PERSONA_ROW_ID || row?.name === PERSONA_PLUGIN_NAME) : undefined
            const prefix = typeof payload?.personaPrefix === 'string' ? payload.personaPrefix : (persona?.config?.prefix ?? '')
            const suffix = typeof payload?.personaSuffix === 'string' ? payload.personaSuffix : (persona?.config?.suffix ?? '')
            if (persona === undefined) config.plugins = [{ id: PERSONA_ROW_ID, name: PERSONA_PLUGIN_NAME, config: {} }, ...(config.plugins ?? [])]
            const target = config.plugins.find((row) => row?.id === PERSONA_ROW_ID || row?.name === PERSONA_PLUGIN_NAME)
            target.config = { ...(target.config ?? {}), prefix, suffix }
            const converted = valueToNode(doc, { insert: [{ id: `preset-${presetId}`, name: PRESET_ROW_NAME, config }] })
            doc.contents.items.push(converted)
            await commitPatch(patchPath, String(doc))
            return respond(response, 200, {
              ok: true,
              presetId,
              baseId,
              patchPath,
              note: 'created in the profile patch; the live reload re-registers it. New sessions can pick it from the preset menu.',
            })
          } catch (error) {
            return respond(response, 500, { error: `creating preset failed: ${error?.message ?? error}` })
          }
        },
      }),
    'preset-studio: create route',
  )
}
export default { name, inject, apply }
