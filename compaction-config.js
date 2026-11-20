/**
 * dsh-prompt-studio — preset compaction settings host half.
 *
 * The 「预设」 panel's visible editor needs to expose the context-compaction
 * knobs of a preset (the leancat single-action compression) instead of asking
 * the user to hand-edit YAML. This plugin serves that form:
 *
 *   GET  /preset-studio/compaction?id=<presetId>
 *        -> { id, found, engine, config: { alwaysCompact, keepRounds,
 *             remindOnRound, reminder, alwaysMinSpanTokens, retainTokens } }
 *   POST /preset-studio/compaction  { id, ...knobs }
 *        Merge the given keys into that preset's `compaction-basic` row config
 *        in the active profile patch (comment-preserving YAML document API,
 *        timestamped backup, atomic rename), so the live reload re-registers
 *        the preset with the new numbers for new sessions.
 *
 * The preset row is found in the profile patch either as a root row
 * (`- id: preset-<id>`) or inside an `- insert:` list; the engine row is the
 * `compaction-basic` child of the `compaction` group row.
 *
 * @module dsh-prompt-studio/compaction-config
 */

import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import YAML from 'yaml'

export const name = 'preset-compaction'

/** Host services used: the HTTP carrier and its auth gate. */
export const inject = ['webServer', 'connection']

const JS_TAG = 'tag:yaml.org,2002:js'
const JS_TAG_DEF = [{ tag: JS_TAG, resolve: (value) => value }]

/** Engine defaults, mirrored from dsh-compaction-handoff's config schema. */
const DEFAULTS = Object.freeze({
  alwaysCompact: false,
  summaryOnly: false,
  keepRounds: 0,
  remindOnRound: null, // null = follow keepRounds
  reminder: null, // null = engine default text
  alwaysMinSpanTokens: 1024,
  retainTokens: 4096,
})

function respond(response, status, body) {
  const text = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  })
  response.end(text)
}

async function readJsonBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.trim() === '') return {}
  return JSON.parse(raw)
}

const isMap = (node) => node instanceof YAML.YAMLMap
const isSeq = (node) => node instanceof YAML.YAMLSeq

function parsePatch(text) {
  const doc = YAML.parseDocument(text, { customTags: JS_TAG_DEF })
  if (doc.errors.length > 0) throw new Error(`profile patch parse failed: ${doc.errors[0].message}`)
  if (!Array.isArray(doc.contents?.items)) throw new Error('profile patch must be a top-level YAML sequence')
  return doc
}

/** Locate the preset row (root row or inside an insert list). */
function findPresetRow(doc, presetId) {
  let fallback
  for (const item of doc.contents.items) {
    if (!isMap(item)) continue
    if (item.has('insert')) {
      const inserted = item.get('insert')
      if (!isSeq(inserted)) continue
      for (const child of inserted.items) {
        if (isMap(child) && child.get('id') === `preset-${presetId}`) fallback = child
      }
      continue
    }
    if (item.get('id') === `preset-${presetId}`) return item
  }
  return fallback
}

/** The preset's compaction group → compaction-basic row. */
function findEngineRow(presetRow) {
  const config = presetRow?.get?.('config')
  const plugins = config?.get?.('plugins')
  if (!isSeq(plugins)) return undefined
  for (const row of plugins.items) {
    if (!isMap(row) || row.get('id') !== 'compaction') continue
    const groupConfig = row.get('config')
    if (!isSeq(groupConfig)) continue
    for (const child of groupConfig.items) {
      if (isMap(child) && child.get('id') === 'compaction-basic') return child
    }
  }
  return undefined
}

/** Read the engine row's effective knobs (defaults for absent keys). */
function readKnobs(engineRow) {
  const config = engineRow?.get?.('config')
  const out = { ...DEFAULTS }
  if (!isMap(config)) return out
  for (const key of Object.keys(DEFAULTS)) {
    if (!config.has(key)) continue
    out[key] = config.get(key)
  }
  return out
}

/** Ensure the engine row's config mapping, creating it when absent. */
function ensureConfig(engineRow, doc) {
  let config = engineRow.get('config')
  if (!isMap(config)) {
    config = new YAML.YAMLMap()
    engineRow.set('config', config)
  }
  return config
}

/** Set one scalar on a mapping (numbers/booleans/strings accepted). */
function setValue(config, key, value) {
  if (config.has(key)) config.set(key, value)
  else config.items.push(new YAML.Pair(key, value))
}

/** Delete one key when present. */
function dropValue(config, key) {
  if (config.has(key)) config.delete(key)
}

function profileOf(ctx) {
  const profile = ctx.get('profileContext')
  if (profile === undefined || typeof profile.dir !== 'string') throw new Error('profileContext is unavailable; preset editing needs a profile deployment')
  return { dir: profile.dir, patchPath: profile.patchPath ?? join(profile.dir, 'cordis.patch.yml') }
}

async function commitPatch(patchPath, text) {
  const backup = `${patchPath}.bak-preset-editor-${Date.now()}`
  const current = await readFile(patchPath, 'utf8')
  await writeFile(backup, current, 'utf8')
  const tmp = `${patchPath}.tmp-preset-editor-${process.pid}`
  await writeFile(tmp, text, 'utf8')
  await rename(tmp, patchPath)
}

/** Normalize one knob from a request body. */
function normalize(key, raw) {
  switch (key) {
    case 'alwaysCompact':
    case 'summaryOnly':
      return typeof raw === 'boolean' ? raw : undefined
    case 'keepRounds':
    case 'remindOnRound':
    case 'alwaysMinSpanTokens':
    case 'retainTokens':
      return Number.isInteger(raw) && raw >= 0 ? raw : undefined
    case 'reminder':
      return typeof raw === 'string' ? raw : undefined
    default:
      return undefined
  }
}

/** Register the GET/POST routes for the visible compaction form. */
export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/preset-studio/compaction',
        handler: async (request, response) => {
          const rejection = ctx.connection.requestRejection?.(request)
          if (rejection !== undefined) return respond(response, rejection, { error: `auth rejected (HTTP ${String(rejection)})` })
          if (request.method === 'GET') {
            const url = new URL(request.url ?? '/', 'http://dsh.invalid')
            const presetId = url.searchParams.get('id') ?? ''
            if (presetId.length === 0) return respond(response, 400, { error: 'id required' })
            try {
              const { patchPath } = profileOf(ctx)
              const doc = parsePatch(await readFile(patchPath, 'utf8'))
              const presetRow = findPresetRow(doc, presetId)
              if (presetRow === undefined) return respond(response, 404, { error: `preset "${presetId}" is not defined in the profile patch` })
              const engineRow = findEngineRow(presetRow)
              return respond(response, 200, {
                id: presetId,
                found: engineRow !== undefined,
                engine: engineRow === undefined ? null : String(engineRow.get('name') ?? ''),
                config: readKnobs(engineRow),
              })
            } catch (error) {
              return respond(response, 500, { error: `reading compaction settings failed: ${error?.message ?? error}` })
            }
          }
          if (request.method !== 'POST') return respond(response, 405, { error: 'GET or POST required' })
          let payload
          try {
            payload = await readJsonBody(request)
          } catch (error) {
            return respond(response, 400, { error: `invalid JSON: ${String(error)}` })
          }
          const presetId = typeof payload?.id === 'string' ? payload.id : ''
          if (presetId.length === 0) return respond(response, 400, { error: 'id required' })
          try {
            const { patchPath } = profileOf(ctx)
            const doc = parsePatch(await readFile(patchPath, 'utf8'))
            const presetRow = findPresetRow(doc, presetId)
            if (presetRow === undefined) return respond(response, 404, { error: `preset "${presetId}" is not defined in the profile patch` })
            const engineRow = findEngineRow(presetRow)
            if (engineRow === undefined) return respond(response, 404, { error: `preset "${presetId}" has no compaction-basic row` })
            const config = ensureConfig(engineRow, doc)
            // Every provided knob must normalize successfully: a typo or an
            // out-of-range number is rejected instead of silently ignored, so a
            // form bug cannot persist a half-written config.
            const rejected = []
            let changed = 0
            for (const key of Object.keys(DEFAULTS)) {
              if (!(key in payload)) continue
              const raw = payload[key]
              if (key === 'remindOnRound' && (raw === null || raw === '')) {
                dropValue(config, key)
                changed += 1
                continue
              }
              if (key === 'reminder' && (raw === '' || raw === null)) {
                dropValue(config, key)
                changed += 1
                continue
              }
              const value = normalize(key, raw)
              if (value === undefined) {
                rejected.push(`${key}=${JSON.stringify(raw)}`)
                continue
              }
              setValue(config, key, value)
              changed += 1
            }
            if (rejected.length > 0) {
              return respond(response, 400, { error: `invalid compaction setting(s): ${rejected.join(', ')}` })
            }
            if (changed === 0) return respond(response, 400, { error: 'no compaction setting provided' })
            await commitPatch(patchPath, String(doc))
            return respond(response, 200, {
              ok: true,
              id: presetId,
              changed,
              patchPath,
              note: 'saved; the live reload re-registers the preset for new sessions (already-open sessions keep their composition)',
            })
          } catch (error) {
            return respond(response, 500, { error: `saving compaction settings failed: ${error?.message ?? error}` })
          }
        },
      }),
    'preset-compaction: settings route',
  )
}

export default { name, inject, apply }