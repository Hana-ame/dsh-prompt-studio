/**
 * dsh-prompt-studio — package entry.
 *
 * The Loader row for this package MUST use the exact package specifier
 * `dsh-prompt-studio` (not a subpath like `/presets`): the client-modules
 * scanner only derives a browser module from a row whose name is an exact
 * package specifier. This entry therefore re-exports the preset-authoring
 * host plugin so one row both mounts the HTTP routes and puts `client.js`
 * into the browser boot graph.
 *
 * @module dsh-prompt-studio
 */
export { default, name, inject, apply } from './presets.js'
