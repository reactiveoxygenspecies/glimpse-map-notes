export const MODULE_ID = "glimpse-map-notes";

export const SOCKET = `module.${MODULE_ID}`;

export const TEMPLATE = `modules/${MODULE_ID}/templates/card.hbs`;

export const LIGHTBOX_TEMPLATE = `modules/${MODULE_ID}/templates/lightbox.hbs`;

/** Card width in CSS pixels for each size setting. */
export const CARD_WIDTHS = {small: 300, medium: 380, large: 480, cinematic: 640};

/** Approximate number of text characters kept in the excerpt for each setting. */
export const EXCERPT_LENGTHS = {none: 0, short: 260, medium: 560, long: 1100};

/** Per-note display modes stored in the note's flags. */
export const NOTE_MODES = ["auto", "full", "image", "text", "off"];

/** How a location is discovered. */
export const DISCOVERY_MODES = ["known", "rumour", "explore"];

/** Maximum number of images collected for a single card. */
export const MAX_MEDIA = 8;

/**
 * Read one of this module's settings.
 * @param {string} key
 * @returns {*}
 */
export function setting(key) {
  return game.settings.get(MODULE_ID, key);
}

/**
 * Localize a key under this module's namespace.
 * @param {string} key
 * @param {object} [data]   Values to format into the string
 * @returns {string}
 */
export function loc(key, data) {
  return data ? game.i18n.format(`GLIMPSE.${key}`, data) : game.i18n.localize(`GLIMPSE.${key}`);
}

/**
 * This module's flags on a document.
 * @param {ClientDocument} doc
 * @returns {object}
 */
export function flagsOf(doc) {
  return doc?.flags?.[MODULE_ID] ?? {};
}

/**
 * The module API, available after the ready hook.
 * @returns {object|undefined}
 */
export function api() {
  return game.modules.get(MODULE_ID)?.api;
}
