import {MODULE_ID, CARD_WIDTHS, EXCERPT_LENGTHS, ICON_SEALS, MAX_MEDIA, SEALS, flagsOf, loc, setting}
  from "./constants.mjs";

/**
 * @typedef GlimpseSource
 * Anything Glimpse can describe: a map note or a scene region.
 * @property {"note"|"region"} kind
 * @property {string} uuid                    UUID of the note or region document
 * @property {object} flags                   This module's flags on that document
 * @property {JournalEntry|null} entry        The linked journal entry
 * @property {JournalEntryPage|null} page     The linked page, if the source points at a single page
 * @property {string} title                   The name of the place
 * @property {string} icon                    File name of the note's map icon, without extension ("" for regions)
 * @property {boolean} canOpen                Whether this user can open the linked journal
 * @property {{x: number, y: number}|null} point   Scene position, for exploration and travel
 */

/**
 * @typedef GlimpseMedia
 * @property {string} src         The image or video path
 * @property {boolean} isVideo    Whether this is a video file
 * @property {string} caption     An optional caption
 * @property {string} focus       CSS object-position for the important part of the image
 */

/**
 * @typedef GlimpseLocation
 * @property {"note"|"region"} kind
 * @property {string} uuid
 * @property {string} title
 * @property {string} subtitle
 * @property {string} seal              The Ink & Seal style's seal character, or ""
 * @property {GlimpseMedia[]} media
 * @property {string} body              Enriched, trimmed HTML excerpt
 * @property {boolean} truncated        Whether the excerpt was cut short
 * @property {{label: string, value: string}[]} facts
 * @property {"full"|"image"|"text"} layout
 * @property {string|null} size         A size chosen for this location, overriding the player's setting
 * @property {boolean} rumoured         The player only sees the rumour
 * @property {boolean} rumourBadge      The GM is told players only see the rumour
 * @property {string} sound             Ambient sound path
 * @property {boolean} canOpen
 * @property {{x: number, y: number}|null} point
 */

/** Built locations, keyed by source and the state that affects them. */
const cache = new Map();

export function clearCache() {
  cache.clear();
}

/* -------------------------------------------- */
/*  Sources                                     */
/* -------------------------------------------- */

/**
 * Describe a note as a Glimpse source.
 * @param {NoteDocument} doc
 * @returns {GlimpseSource}
 */
export function noteSource(doc) {
  return {
    kind: "note",
    uuid: doc.uuid,
    flags: flagsOf(doc),
    entry: doc.entry ?? null,
    page: doc.page ?? null,
    title: doc.label,
    icon: doc.texture?.src?.split("/").pop().replace(/\.\w+$/, "") ?? "",
    canOpen: canOpenNote(doc),
    point: {x: doc.x, y: doc.y}
  };
}

/**
 * Can this user open the journal a note links to? Mirrors core Note#_canView, but works from the document so it
 * also answers for notes on scenes that are not being viewed.
 * @param {NoteDocument} doc
 * @returns {boolean}
 */
export function canOpenNote(doc) {
  const {entry, page} = doc;
  if ( !entry ) return false;
  if ( game.user.isGM ) return true;
  if ( page?.testUserPermission(game.user, "LIMITED", {exact: true}) ) return page.type === "image";
  return (page ?? entry).testUserPermission(game.user, "OBSERVER");
}

/**
 * Describe a region as a Glimpse source.
 * @param {RegionDocument} doc
 * @returns {GlimpseSource}
 */
export function regionSource(doc) {
  const flags = flagsOf(doc);
  const entry = game.journal.get(flags.entryId) ?? null;
  const page = entry?.pages.get(flags.pageId) ?? null;
  const viewable = page ?? entry;
  const center = doc.object?.center;
  return {
    kind: "region",
    uuid: doc.uuid,
    flags,
    entry,
    page,
    title: flags.title || page?.name || entry?.name || doc.name,
    icon: "",
    canOpen: !!viewable && (game.user.isGM || (page ? canViewPage(page) : entry.testUserPermission(game.user, "OBSERVER"))),
    point: center ? {x: center.x, y: center.y} : null
  };
}

/**
 * Is Glimpse switched on for this region?
 * @param {RegionDocument} doc
 * @returns {boolean}
 */
export function regionEnabled(doc) {
  const flags = flagsOf(doc);
  return !!flags.enabled && ((flags.mode ?? "auto") !== "off");
}

/* -------------------------------------------- */
/*  State                                       */
/* -------------------------------------------- */

/**
 * Can the current user see the contents of this page? Mirrors core Note#_canView: image pages are shown at
 * Limited permission, everything else requires Observer.
 * @param {JournalEntryPage} page
 * @returns {boolean}
 */
export function canViewPage(page) {
  if ( game.user.isGM ) return true;
  if ( page.type === "image" ) return page.testUserPermission(game.user, "LIMITED");
  return page.testUserPermission(game.user, "OBSERVER");
}

/**
 * Is this page included when the GM shows a location to the table? Every page is, shared or not, except pages whose
 * own permission the GM set to None: those are kept as GM notes.
 * @param {JournalEntryPage} page
 * @returns {boolean}
 */
export function shownToTable(page) {
  return page._source.ownership?.default !== CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
}

/* -------------------------------------------- */
/*  Reading Pages                               */
/* -------------------------------------------- */

/**
 * @typedef GlimpsePageContent
 * What Glimpse can show from one journal page.
 * @property {string} [html]      Player-facing text
 * @property {string} [image]     An image or video path
 * @property {string} [caption]   A caption for that image
 */

/**
 * Readers for journal page types, keyed by type. Systems and modules can add their own through the API.
 * @type {Record<string, (page: JournalEntryPage) => GlimpsePageContent>}
 */
export const PAGE_READERS = {
  text: page => ({html: page.text?.content}),
  image: page => ({image: page.src, caption: page.image?.caption}),
  video: page => ({image: page.src}),
  pdf: () => ({})
};

/**
 * Fields that commonly hold the player-facing text of system page types. GM-only fields are never read.
 * @type {string[]}
 */
const TEXT_FIELDS = ["content.overview", "content.public", "content.description", "description.value", "description",
  "content", "overview", "summary", "text"];

/** Fields that commonly hold a page's artwork. */
const IMAGE_FIELDS = ["banner.img", "banner.src", "img", "image", "src", "artwork"];

/** Fields that commonly hold the caption for that artwork. */
const CAPTION_FIELDS = ["banner.caption", "caption"];

/**
 * Read what Glimpse can show from a page, whatever its type.
 * @param {JournalEntryPage} page
 * @returns {GlimpsePageContent}
 */
export function readPage(page) {
  const reader = PAGE_READERS[page.type];
  const content = reader ? reader(page) : readSystemPage(page);
  return {
    html: (typeof content.html === "string") && content.html.trim() ? content.html : "",
    image: content.image || "",
    caption: content.caption || ""
  };
}

/**
 * Best-effort reading of a system-defined page type (for example Ember's lore, culture and location pages).
 * @param {JournalEntryPage} page
 * @returns {GlimpsePageContent}
 */
function readSystemPage(page) {
  const data = page.system;
  const pick = fields => {
    for ( const field of fields ) {
      const value = foundry.utils.getProperty(data ?? {}, field);
      if ( (typeof value === "string") && value.trim() ) return value;
    }
    return "";
  };
  // Only fall back to the core text field when the system stores nothing of its own; Ember, for instance, keeps a
  // placeholder there while the real text lives in its data model.
  const hasSystemData = !!data && !foundry.utils.isEmpty(data.toObject?.() ?? data);
  const html = pick(TEXT_FIELDS) || (hasSystemData ? "" : page.text?.content) || "";
  return {html, image: pick(IMAGE_FIELDS) || page.src, caption: pick(CAPTION_FIELDS)};
}

/**
 * Is it currently night in the world, according to the configured night hours?
 * @returns {boolean}
 */
export function isNight() {
  const start = setting("nightStart");
  const end = setting("nightEnd");
  if ( start === end ) return false;
  const hour = game.time.components?.hour ?? 12;
  return start > end ? ((hour >= start) || (hour < end)) : ((hour >= start) && (hour < end));
}

/**
 * Has this user explored the given point of the current scene?
 * @param {{x: number, y: number}} point
 * @returns {boolean}
 */
function isExplored(point) {
  if ( !point || !canvas.ready || !canvas.visibility?.tokenVision ) return false;
  if ( canvas.scene?.fog?.exploration === false ) return false;
  return canvas.fog.isPointExplored(point);
}

/**
 * Does this source still hide behind a rumour for players?
 * @param {GlimpseSource} source
 * @param {object} [options]
 * @param {boolean} [options.ignoreExploration]   Only consider the GM's "visited" switch
 * @returns {boolean}
 */
export function isRumoured(source, {ignoreExploration=false}={}) {
  const {discovery="known", visited} = source.flags;
  if ( (discovery === "known") || visited ) return false;
  if ( (discovery === "explore") && !ignoreExploration && isExplored(source.point) ) return false;
  return true;
}

/* -------------------------------------------- */
/*  Building                                    */
/* -------------------------------------------- */

/**
 * Gather everything a card needs to know about a source, respecting the current user's permissions.
 * @param {GlimpseSource} source
 * @param {object} [options]
 * @param {string} [options.excerpt]       Override the excerpt length setting
 * @param {boolean} [options.secrets]      Override the secrets setting
 * @param {boolean} [options.reveal]       Build the full location for a GM reveal, ignoring rumours
 * @param {"self"|"table"} [options.audience="self"]  The current user's permissions, or what the GM shows the
 *                                         table: every page except GM-only ones.
 * @param {boolean} [options.titleOnly]   A name alone is worth showing, for example on a timed region banner
 * @param {boolean} [options.cache=true]   Use and fill the cache
 * @returns {Promise<GlimpseLocation|null>}   Null when there is nothing worth showing.
 */
export async function getLocation(source, {excerpt, secrets, reveal=false, audience="self", titleOnly=false,
  cache: useCache=true}={}) {
  excerpt ??= setting("excerpt");
  secrets ??= setting("secrets");
  const rumoured = !reveal && !game.user.isGM && isRumoured(source);
  const night = isNight();
  const key = [source.uuid, excerpt, secrets, rumoured, night, reveal, audience, titleOnly].join(":");
  if ( useCache && cache.has(key) ) return cache.get(key);
  const location = await buildLocation(source, {excerpt, secrets, rumoured, night, reveal, audience, titleOnly});
  if ( useCache ) cache.set(key, location);
  return location;
}

/**
 * @param {GlimpseSource} source
 * @param {object} options
 * @returns {Promise<GlimpseLocation|null>}
 */
async function buildLocation(source, {excerpt, secrets, rumoured, night, reveal, audience, titleOnly}) {
  const flags = source.flags;
  const mode = flags.mode || "auto";
  if ( (mode === "off") && !reveal ) return null;

  // Determine which pages the audience may read. A source pinned to a single page only ever shows that page.
  const {entry, page} = source;
  const forTable = audience === "table";
  const visible = forTable ? shownToTable : canViewPage;
  let pages = [];
  if ( page ) pages = visible(page) ? [page] : [];
  else if ( entry ) pages = entry.pages.contents.sort((a, b) => a.sort - b.sort).filter(visible);

  // Media: the source's own image first, then image and video pages in journal order.
  const media = [];
  const addMedia = (src, {caption, focusX, focusY}={}) => {
    if ( !src || (media.length >= MAX_MEDIA) || media.some(m => m.src === src) ) return;
    media.push({
      src,
      isVideo: foundry.helpers.media.VideoHelper.hasVideoExtension(src),
      caption: caption || "",
      focus: `${focusX ?? 50}% ${focusY ?? 50}%`
    });
  };
  const sourceFocus = {focusX: flags.focusX, focusY: flags.focusY};
  addMedia((night && flags.nightImage) || flags.image, sourceFocus);
  const read = new Map(pages.map(p => [p, readPage(p)]));
  for ( const [p, content] of read ) {
    const pageFlags = flagsOf(p);
    const focus = {caption: content.caption, focusX: pageFlags.focusX, focusY: pageFlags.focusY};
    addMedia((night && pageFlags.night) || content.image, focus);
  }

  // Text: the first readable page with text, enriched and trimmed to an excerpt.
  const excerptLength = EXCERPT_LENGTHS[excerpt] ?? EXCERPT_LENGTHS.medium;
  const textPage = pages.find(p => read.get(p).html);
  let body = "";
  let truncated = false;
  if ( textPage ) {
    const html = await foundry.applications.ux.TextEditor.implementation.enrichHTML(read.get(textPage).html, {
      secrets: textPage.isOwner && secrets,
      relativeTo: textPage
    });
    const result = extractExcerpt(html, rumoured ? 0 : excerptLength);
    // Pictures pasted into the text still count, even when the text itself stays hidden behind a rumour.
    for ( const src of result.images ) addMedia(src);
    if ( !rumoured ) {
      body = result.html;
      truncated = result.truncated;
    }
  }

  // Players who have not discovered the place only get the rumour and a veiled first image.
  if ( rumoured ) {
    media.length = Math.min(media.length, 1);
    body = rumourHTML(flags.rumour);
  }

  // Resolve the layout.
  if ( (mode === "text") && !reveal ) media.length = 0;
  if ( (mode === "image") && !reveal ) body = "";
  const facts = rumoured ? [] : parseFacts(flags.facts);
  if ( !media.length && !body && !flags.subtitle && !facts.length && !titleOnly ) return null;
  const layout = media.length ? (body ? "full" : "image") : "text";

  // A note pinned to one page of a larger journal shows the journal's name as its subtitle.
  let subtitle = rumoured ? loc("Rumoured") : (flags.subtitle || "");
  if ( !subtitle && page && entry && (entry.name !== source.title)
    && (forTable || entry.testUserPermission(game.user, "LIMITED")) ) {
    subtitle = entry.name;
  }

  return {
    kind: source.kind,
    uuid: source.uuid,
    title: source.title,
    subtitle,
    seal: sealFor(source),
    media,
    body,
    truncated,
    facts,
    layout,
    size: (flags.size in CARD_WIDTHS) ? flags.size : null,
    rumoured,
    rumourBadge: game.user.isGM && !reveal && isRumoured(source, {ignoreExploration: true}),
    sound: rumoured ? "" : (flags.sound || ""),
    canOpen: source.canOpen && !rumoured,
    point: source.point
  };
}

/**
 * The seal the Ink & Seal style stamps beside the name: the one chosen for the note, else one that matches its map
 * icon, else "place" for notes and "land" for regions.
 * @param {GlimpseSource} source
 * @returns {string}   The seal's character, or "" for none
 */
function sealFor(source) {
  const chosen = source.flags.seal;
  if ( chosen === "none" ) return "";
  const key = (chosen in SEALS) ? chosen : (ICON_SEALS[source.icon] ?? (source.kind === "region" ? "land" : "place"));
  return SEALS[key];
}

/**
 * Turn the GM's rumour text into a few safe paragraphs.
 * @param {string} [text]
 * @returns {string}
 */
function rumourHTML(text) {
  const lines = (text || loc("RumourDefault")).split(/\n+/).map(l => l.trim()).filter(Boolean);
  return lines.map(l => `<p>${foundry.utils.escapeHTML(l)}</p>`).join("");
}

/** Most facts shown as chips on one card. */
export const MAX_FACTS = 6;

/**
 * Parse "Label: value" lines into facts.
 * @param {string} [text]
 * @returns {{label: string, value: string}[]}
 */
export function parseFacts(text) {
  if ( !text ) return [];
  return text.split("\n").map(line => line.trim()).filter(Boolean).slice(0, MAX_FACTS).map(line => {
    const i = line.indexOf(":");
    if ( i < 0 ) return {label: "", value: line};
    return {label: line.slice(0, i).trim(), value: line.slice(i + 1).trim()};
  });
}

/**
 * Turn enriched journal HTML into a short excerpt. Images are pulled out so they can join the gallery,
 * and the text is cut after whole blocks once the character budget is spent.
 * @param {string} html
 * @param {number} maxLength
 * @returns {{html: string, images: string[], truncated: boolean}}
 */
function extractExcerpt(html, maxLength) {
  // A template element parses inertly, so images in the journal are not fetched here.
  const template = document.createElement("template");
  template.innerHTML = html;
  const root = template.content;

  // Collect and remove media so the excerpt is text only.
  const images = [];
  for ( const img of root.querySelectorAll("img") ) {
    const src = img.getAttribute("src");
    if ( src ) images.push(src);
  }
  root.querySelectorAll("img, video, iframe, figure").forEach(el => el.remove());

  if ( maxLength <= 0 ) return {html: "", images, truncated: false};

  // Drop blocks that are empty once media is gone.
  for ( const el of root.querySelectorAll("p, div, section, span") ) {
    if ( !el.textContent.trim() && !el.querySelector("hr") ) el.remove();
  }

  // Keep whole top-level blocks until the budget is spent. A block that would run well past it is cut at a word
  // instead, unless only a few characters would be left of it.
  let used = 0;
  let truncated = false;
  for ( const node of Array.from(root.childNodes) ) {
    if ( used >= maxLength ) {
      node.remove();
      truncated = true;
      continue;
    }
    const length = node.textContent.trim().length;
    if ( (node.nodeType === Node.TEXT_NODE) && !length ) {
      node.remove();
      continue;
    }
    if ( used + length <= maxLength * 1.4 ) {
      used += length;
      continue;
    }
    const room = maxLength - used;
    if ( (used > 0) && (room < MIN_CUT) ) node.remove();
    else cutText(node, Math.max(room, MIN_CUT));
    used = maxLength;
    truncated = true;
  }

  // Remove trailing horizontal rules or headings that would dangle at the end.
  let last = root.lastElementChild;
  while ( last && /^(HR|H[1-6])$/.test(last.tagName) ) {
    last.remove();
    truncated = true;
    last = root.lastElementChild;
  }

  return {html: template.innerHTML.trim(), images, truncated};
}

/** Fewest characters worth keeping when a block has to be cut. */
const MIN_CUT = 80;

/**
 * Shorten a node's text to about `length` characters, ending on a whole word with an ellipsis. Inline markup
 * before the cut is kept; everything after it is removed.
 * @param {Node} node
 * @param {number} length
 */
function cutText(node, length) {
  const walker = node.ownerDocument.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  let remaining = length;
  let text = (node.nodeType === Node.TEXT_NODE) ? node : walker.nextNode();
  for ( ; text; text = walker.nextNode() ) {
    if ( text.data.length <= remaining ) {
      remaining -= text.data.length;
      continue;
    }
    // Cut at the last space that keeps most of the allowance, or mid-word if there is none.
    const space = text.data.lastIndexOf(" ", remaining);
    const at = space > remaining * 0.6 ? space : remaining;
    if ( text !== node ) {
      const range = node.ownerDocument.createRange();
      range.setStart(text, at);
      range.setEnd(node, node.childNodes.length);
      range.deleteContents();
    }
    text.data = `${text.data.slice(0, at).replace(/[\s,;:.\-–—]+$/, "")}…`;
    return;
  }
}
