/**
 * Preset authoring route tests against a COPY of the live profile patch:
 * list classification, in-place persona edit (comment-preserving), bundle
 * preset override append, and new preset creation from a base template.
 *
 * Run: node --test test/presets.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import YAML from 'yaml'

import presetsPlugin from '../presets.js'

const REAL_PROFILE_DIR = '/home/lumin/.dsh/profiles/web'
const REAL_PATCH = join(REAL_PROFILE_DIR, 'cordis.patch.yml')

/** Minimal response double collecting the JSON body. */
function fakeResponse() {
  let body = ''
  let status = 0
  return {
    writeHead(code) { status = code },
    end(text) { body = text },
    get status() { return status },
    get json() { return body === '' ? undefined : JSON.parse(body) },
  }
}

/** Minimal request double for GET or POST JSON. */
function fakeRequest(method, body) {
  return {
    method,
    url: '/',
    [Symbol.asyncIterator]: async function* () {
      if (body === undefined) return
      yield Buffer.from(JSON.stringify(body), 'utf8')
    },
  }
}

/** Stand up the plugin against a patch copy and return captured routes + ctx. */
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'preset-studio-'))
  const patchPath = join(dir, 'cordis.patch.yml')
  await copyFile(REAL_PATCH, patchPath)
  const routes = new Map()
  const ctx = {
    webServer: { register: (route) => { routes.set(route.path, route.handler); return () => {} } },
    connection: { requestRejection: () => undefined },
    get(name) {
      if (name === 'profileContext') return { dir: REAL_PROFILE_DIR, patchPath }
      if (name === 'agentPresets') {
        return {
          async list() {
            return [
              { id: 'standard', name: 'Standard', description: 'std', order: 1 },
              { id: 'leancat', name: 'Lean Context', description: 'lean', order: 8 },
              { id: 'ptc', name: 'PTC', description: 'ptc', order: 2 },
            ]
          },
        }
      }
      return undefined
    },
    effect: (fn) => { fn(); return () => {} },
  }
  presetsPlugin.apply(ctx)
  const call = async (path, method, body) => {
    const handler = routes.get(path)
    assert.ok(handler, `route ${path} registered`)
    const response = fakeResponse()
    await handler(fakeRequest(method, body), response)
    return response
  }
  return { dir, patchPath, call, readPatch: () => readFile(patchPath, 'utf8') }
}

test('list classifies patch-defined vs bundle presets with persona text', async () => {
  const { call, dir } = await setup()
  const res = await call('/preset-studio/list', 'GET')
  assert.equal(res.status, 200, JSON.stringify(res.json))
  const ids = res.json.presets.map((p) => p.id).sort()
  assert.deepEqual(ids, ['leancat', 'ptc', 'standard'])
  const leancat = res.json.presets.find((p) => p.id === 'leancat')
  assert.equal(leancat.source, 'profile-patch')
  assert.ok(leancat.personaPrefix.includes('lean-context'))
  const ptc = res.json.presets.find((p) => p.id === 'ptc')
  assert.equal(ptc.source, 'bundle')
  await rm(dir, { recursive: true, force: true })
})

test('save edits an existing patch preset in place and preserves comments/tags', async () => {
  const { call, dir, readPatch } = await setup()
  const res = await call('/preset-studio/save', 'POST', {
    id: 'leancat',
    personaPrefix: 'TEST PERSONA from preset editor.',
    name: 'Lean Context',
  })
  assert.equal(res.status, 200, JSON.stringify(res.json))
  const text = await readPatch()
  // persona replaced in place
  assert.ok(text.includes('TEST PERSONA from preset editor.'))
  // comments from the original patch survive
  assert.ok(text.includes('2026-11-11 peer-message'))
  // js expressions survive with their EXPRESSION TEXT (not coerced values)
  assert.ok(text.includes("!!js process.platform === 'win32'"), 'win32 guard expression preserved verbatim')
  assert.ok(text.includes("!!js process.platform !== 'win32'"), 'non-win32 guard expression preserved verbatim')
  assert.ok(!text.includes('!!js true'), 'no expression coerced to `true`')
  assert.ok(!text.includes('!!js false'), 'no expression coerced to `false`')
  // other preset rows survive
  assert.ok(text.includes("id: preset-standard"))
  // still parses as a YAML sequence
  const doc = YAML.parseDocument(text, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (v) => v }] })
  assert.equal(doc.errors.length, 0)
  await rm(dir, { recursive: true, force: true })
})

test('save on a bundle preset appends a full override row', async () => {
  const { call, dir, readPatch } = await setup()
  const res = await call('/preset-studio/save', 'POST', { id: 'ptc', personaPrefix: 'PTC TEST PERSONA.' })
  assert.equal(res.status, 200, JSON.stringify(res.json))
  const text = await readPatch()
  assert.ok(text.includes('PTC TEST PERSONA.'))
  const doc = YAML.parseDocument(text, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (v) => v }] })
  assert.equal(doc.errors.length, 0)
  // appended root row exists with the same id and a full config
  const appended = doc.contents.items.find((item) => item?.get?.('id') === 'preset-ptc')
  assert.ok(appended, 'override row appended at root')
  const config = appended.get('config')
  assert.equal(config.get('id'), 'ptc')
  assert.ok(Array.isArray(config.get('plugins').items) && config.get('plugins').items.length > 10)
  await rm(dir, { recursive: true, force: true })
})

test('create appends a new insert block cloned from the base preset', async () => {
  const { call, dir, readPatch } = await setup()
  const res = await call('/preset-studio/create', 'POST', {
    id: 'my-preset',
    name: 'My Preset',
    order: 9,
    baseId: 'standard',
    personaPrefix: 'You are my custom assistant.',
    personaSuffix: 'Your working directory is {{cwd}}.',
  })
  assert.equal(res.status, 200, JSON.stringify(res.json))
  const text = await readPatch()
  assert.ok(text.includes('You are my custom assistant.'))
  const doc = YAML.parseDocument(text, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (v) => v }] })
  assert.equal(doc.errors.length, 0)
  const block = doc.contents.items.find((item) => item?.get?.('insert')?.[Symbol.iterator] === undefined && item?.has?.('insert') && item.get('insert').items.some((row) => row?.get?.('id') === 'preset-my-preset'))
  assert.ok(block, 'new insert block appended')
  const row = block.get('insert').items.find((r) => r.get('id') === 'preset-my-preset')
  const config = row.get('config')
  assert.equal(config.get('id'), 'my-preset')
  assert.equal(config.get('name'), 'My Preset')
  assert.equal(config.get('order'), 9)
  const persona = config.get('plugins').items.find((p) => p.get('id') === 'persona')
  assert.equal(persona.get('config').get('prefix'), 'You are my custom assistant.')
  await rm(dir, { recursive: true, force: true })
})

test('create refuses a duplicate preset id', async () => {
  const { call, dir } = await setup()
  const res = await call('/preset-studio/create', 'POST', { id: 'standard', name: 'dup' })
  assert.equal(res.status, 409)
  await rm(dir, { recursive: true, force: true })
})