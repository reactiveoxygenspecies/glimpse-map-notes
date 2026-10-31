export const MODULE_ID = "glimpse-map-notes";

export const SOCKET = `module.${MODULE_ID}`;

export const TEMPLATE = `modules/${MODULE_ID}/templates/card.hbs`;

export const LIGHTBOX_TEMPLATE = `modules/${MODULE_ID}/templates/lightbox.hbs`;

/** Card width in CSS pixels for each size setting. */
export const CARD_WIDTHS = {small: 300, medium: 380, large: 480, cinematic: 640};

/** Card styles, in the order the setting lists them. */
export const CARD_STYLES = ["dusk", "parchment", "foundry", "tome", "bound", "holo", "horizon", "horizon-cream",
  "dossier", "terminal", "neon", "woodcut", "gothic", "frontier", "ink", "domain"];

/** Styles that draw screen scanlines, which the Scanlines setting turns off. */
export const SCANLINE_STYLES = ["holo", "terminal"];

/** Styles that recolour their pictures, which the Image effects setting turns off. */
export const IMAGE_EFFECT_STYLES = ["dossier", "terminal", "woodcut", "gothic", "frontier"];

/** The style "Match game system" picks for each system id. Systems not listed fall back to the interface theme. */
export const SYSTEM_STYLES = {
  dnd5e: "tome", pf1: "tome",
  pf2e: "bound", sf2e: "bound",
  sfrpg: "holo", swnr: "holo",
  yzecoriolis: "horizon",
  CoC7: "dossier", deltagreen: "dossier", vaesen: "dossier",
  alienrpg: "terminal", mosh: "terminal",
  "cyberpunk-red-core": "neon", shadowrun5e: "neon",
  "forbidden-lands": "woodcut", dragonbane: "woodcut", ose: "woodcut", shadowdark: "woodcut",
  vtm5e: "gothic", wod5e: "gothic",
  l5r5e: "ink",
  daggerheart: "domain"
};

/** The seals the Ink & Seal style stamps beside a card's name. */
export const SEALS = {
  place: "所", land: "地", city: "都", town: "町", village: "村", inn: "宿", market: "市", harbor: "港",
  castle: "城", temple: "寺", shrine: "社", mountain: "山", cave: "洞", forest: "森", water: "水", road: "道",
  ruins: "跡", grave: "墓", danger: "危", battle: "戦", spirit: "霊", secret: "秘", treasure: "宝", people: "人"
};

/** The seal a note gets from its map icon, by the icon's file name. Covers Glimpse's icons and Foundry's own. */
export const ICON_SEALS = {
  capital: "city", city: "city", town: "town", village: "village", house: "village", farm: "village",
  windmill: "village", inn: "inn", tankard: "inn", "hanging-sign": "inn", market: "market", coins: "market",
  barrel: "market", port: "harbor", ship: "harbor", lighthouse: "harbor", anchor: "harbor", airship: "harbor",
  castle: "castle", tower: "castle", watchtower: "castle", fort: "castle", gate: "castle", ruins: "ruins",
  temple: "temple", shrine: "shrine", stones: "shrine", obelisk: "shrine", statue: "shrine",
  portal: "spirit", crystal: "spirit", eye: "spirit", moon: "spirit", sun: "spirit", star: "spirit", arcane: "spirit",
  mountain: "mountain", volcano: "mountain", hills: "mountain", cave: "cave", mine: "cave",
  forest: "forest", tree: "forest", oak: "forest", mushroom: "forest", swamp: "forest", pawprint: "forest",
  desert: "land", oasis: "water", lake: "water", waterfall: "water", whirlpool: "water", well: "water",
  island: "water", bridge: "road", trail: "road", signpost: "road", compass: "road",
  skull: "danger", danger: "danger", web: "danger", flame: "danger", fire: "danger", lair: "danger", trap: "danger",
  battle: "battle", sword: "battle", shield: "battle", graveyard: "grave",
  mystery: "secret", key: "secret", scroll: "secret", quest: "secret", treasure: "treasure", chest: "treasure"
};

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
