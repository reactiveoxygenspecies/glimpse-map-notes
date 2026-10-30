import {MODULE_ID, api, flagsOf, setting} from "./constants.mjs";

/**
 * Importing and exporting a scene's places as a JSON manifest: one entry per map note, with its journal (image pages
 * and a text page) and its Glimpse settings. It is the same format the glimpse skill writes, so lore kept in another
 * repository can be brought in, and a scene's notes can be taken out, edited and brought back.
 *
 * Records are tagged with flags.world.glimpseLoreId so later imports update them instead of making duplicates, and
 * pages made by an import are tagged flags.world.glimpseManaged. Pages written by hand are never changed or removed.
 */

/** Glimpse flags a manifest entry can set directly. */
const GLIMPSE_KEYS = ["mode", "size", "image", "focusX", "focusY", "nightImage", "subtitle", "facts", "sound", "seal",
  "discovery", "rumour", "visited"];

/** Journal permissions by name. */
const OWNERSHIP = {none: 0, limited: 1, observer: 2, owner: 3};

/** The folder new journals go into, unless the import names another. */
const DEFAULT_FOLDER = "Glimpse Locations";

const loreId = doc => doc?.flags?.world?.glimpseLoreId;
const isManaged = page => !!page.flags?.world?.glimpseManaged;
const sortedPages = entry => (entry?.pages.contents ?? []).sort((a, b) => a.sort - b.sort);

/**
 * @typedef GlimpseManifestLocation
 * One place in a manifest. Only `id` and `name` are required; see the README for every field.
 * @property {string} id                 Stable id, kept on the note and journal so later imports update them
 * @property {string} name               Journal name and default pin label
 * @property {{x: number, y: number}} [position]   Scene coordinates, needed to make a new pin
 */

/* -------------------------------------------- */
/*  Export                                      */
/* -------------------------------------------- */

/**
 * Describe every map note on a scene as a manifest.
 * @param {Scene} [scene]   Defaults to the viewed scene
 * @returns {{glimpse: number, scene: {id: string, name: string}, exported: string,
 *   locations: GlimpseManifestLocation[]}}
 */
export function exportLocations(scene=canvas.scene) {
  const used = new Set();
  const locations = scene.notes.contents.map(note => describeNote(note, used));
  return {glimpse: 1, scene: {id: scene.id, name: scene.name}, exported: new Date().toISOString(), locations};
}

/**
 * @param {NoteDocument} note
 * @param {Set<string>} used   Ids already given out in this export
 * @returns {GlimpseManifestLocation}
 */
function describeNote(note, used) {
  const flags = flagsOf(note);
  const entry = note.entry;
  const source = note._source;
  const name = entry?.name || source.text || note.label;
  let id = loreId(note) || loreId(entry) || name.slugify({strict: true}) || note.id;
  if ( used.has(id) ) id = `${id}-${note.id}`;
  used.add(id);

  const loc = {id, name};
  if ( source.text && (source.text !== name) ) loc.label = source.text;
  if ( flags.subtitle ) loc.subtitle = flags.subtitle;
  if ( flags.facts ) loc.facts = flags.facts.split("\n").map(f => f.trim()).filter(Boolean);

  // The journal: image pages in order, then the first text page.
  const pages = note.page ? [note.page] : sortedPages(entry);
  const images = pages.filter(p => (p.type === "image") && p.src).map(p => {
    const image = {src: p.src};
    if ( p.image?.caption ) image.caption = p.image.caption;
    if ( p.name ) image.name = p.name;
    const pageFlags = flagsOf(p);
    for ( const key of ["focusX", "focusY", "night"] ) if ( pageFlags[key] !== undefined ) image[key] = pageFlags[key];
    return image;
  });
  if ( images.length ) loc.images = images;
  const textPage = pages.find(p => (p.type === "text") && p.text?.content?.trim());
  if ( textPage ) {
    loc.html = textPage.text.content;
    if ( textPage.name !== name ) loc.textTitle = textPage.name;
  }

  // Settings stored on the note itself.
  if ( flags.image ) loc.cardImage = flags.image;
  if ( flags.nightImage ) loc.cardNightImage = flags.nightImage;
  for ( const key of ["focusX", "focusY", "sound", "seal", "mode", "size", "discovery", "rumour"] ) {
    if ( (flags[key] !== undefined) && (flags[key] !== "") ) loc[key] = flags[key];
  }
  if ( flags.visited ) loc.visited = true;

  loc.position = {x: source.x, y: source.y};
  loc.icon = source.texture.src;
  loc.iconSize = source.iconSize;
  loc.fontSize = source.fontSize;
  if ( source.textColor ) loc.textColor = source.textColor;
  if ( entry ) {
    const level = entry.ownership.default;
    loc.ownership = Object.keys(OWNERSHIP).find(k => OWNERSHIP[k] === level) ?? "none";
    // A journal with pages written by hand is linked, not rewritten, when this is imported again.
    if ( sortedPages(entry).some(p => !isManaged(p)) || note.page ) loc.keepJournal = true;
  }
  return loc;
}

/* -------------------------------------------- */
/*  Import                                      */
/* -------------------------------------------- */

/**
 * Read a manifest's locations, from either an export or a bare array.
 * @param {object|object[]} data
 * @returns {object[]|null}   Null when this is not a manifest
 */
export function manifestLocations(data) {
  const locations = Array.isArray(data) ? data : data?.locations;
  return Array.isArray(locations) ? locations : null;
}

/**
 * What a manifest entry is missing to be imported, or "" when it is fine.
 * @param {object} loc
 * @returns {string}
 */
function invalid(loc) {
  if ( !loc || (typeof loc !== "object") ) return "not an object";
  if ( (typeof loc.id !== "string") || !loc.id.trim() ) return "missing id";
  if ( (typeof loc.name !== "string") || !loc.name.trim() ) return "missing name";
  return "";
}

/**
 * Find a location's journal: by its id, then by name in the import folder, then by name anywhere if only one
 * journal has it.
 * @param {object} loc
 * @param {Folder|null} folder
 * @returns {JournalEntry|undefined}
 */
function findEntry(loc, folder) {
  const tagged = game.journal.find(e => loreId(e) === loc.id);
  if ( tagged ) return tagged;
  const named = game.journal.filter(e => e.name === loc.name);
  return named.find(e => folder && (e.folder?.id === folder.id)) ?? ((named.length === 1) ? named[0] : undefined);
}

/**
 * Find a location's map note: by its id, then by its journal, then an unlinked note with the same label.
 * @param {Scene} scene
 * @param {object} loc
 * @param {JournalEntry} [entry]
 * @returns {NoteDocument|undefined}
 */
function findNote(scene, loc, entry) {
  return scene.notes.find(n => loreId(n) === loc.id)
    ?? (entry && scene.notes.find(n => n.entryId === entry.id))
    ?? scene.notes.find(n => !n.entryId && (n._source.text === (loc.label ?? loc.name)));
}

/**
 * The journal permission a new location gets. Known places are readable; rumoured ones stay private until they are
 * discovered when Glimpse shares journals on discovery, else they show their veiled images.
 * @param {object} loc
 * @returns {number}
 */
function defaultOwnership(loc) {
  if ( ((loc.discovery ?? "known") === "known") || loc.visited ) return OWNERSHIP.observer;
  return setting("shareOnDiscovery") === "off" ? OWNERSHIP.limited : OWNERSHIP.none;
}

/**
 * Markdown or HTML description as HTML.
 * @param {object} loc
 * @returns {string}
 */
function descriptionHTML(loc) {
  if ( typeof loc.html === "string" ) return loc.html;
  if ( typeof loc.text !== "string" || !loc.text.trim() ) return "";
  if ( globalThis.showdown ) return new showdown.Converter().makeHtml(loc.text);
  return loc.text.split(/\n{2,}/).map(p => `<p>${foundry.utils.escapeHTML(p.trim())}</p>`).join("");
}

/**
 * The pages a location's journal should have: one image page per image, then one text page.
 * @param {object} loc
 * @returns {object[]}
 */
function desiredPages(loc) {
  const pages = (Array.isArray(loc.images) ? loc.images : []).filter(img => img?.src).map((img, i) => {
    const flags = {world: {glimpseManaged: true}};
    const moduleFlags = {};
    for ( const key of ["focusX", "focusY", "night"] ) if ( img[key] !== undefined ) moduleFlags[key] = img[key];
    if ( !foundry.utils.isEmpty(moduleFlags) ) flags[MODULE_ID] = moduleFlags;
    return {type: "image", name: img.name || img.caption || `${loc.name} ${i + 1}`, src: img.src,
      image: {caption: img.caption ?? ""}, title: {show: false, level: 1}, flags};
  });
  const html = descriptionHTML(loc);
  if ( html ) {
    pages.push({type: "text", name: loc.textTitle || loc.name, title: {show: false, level: 1},
      text: {content: html, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML}, flags: {world: {glimpseManaged: true}}});
  }
  return pages.map((p, i) => ({...p, sort: (i + 1) * CONST.SORT_INTEGER_DENSITY}));
}

/**
 * The Glimpse flags a location sets. A field given as "" clears it; a field left out keeps its current value.
 * @param {object} loc
 * @returns {object}
 */
function glimpseFlags(loc) {
  const facts = Array.isArray(loc.facts) ? loc.facts.join("\n") : loc.facts;
  const values = {...loc, facts, image: loc.cardImage, nightImage: loc.cardNightImage};
  const flags = {};
  for ( const key of GLIMPSE_KEYS ) if ( values[key] !== undefined ) flags[key] = values[key];
  return flags;
}

/**
 * Pin appearance fields a location sets.
 * @param {object} loc
 * @returns {object}
 */
function pinLook(loc) {
  const look = {"texture.src": loc.icon, iconSize: loc.iconSize, fontSize: loc.fontSize, textColor: loc.textColor};
  return Object.fromEntries(Object.entries(look).filter(([, v]) => v !== undefined));
}

/**
 * @typedef GlimpseImportRow
 * @property {string} id
 * @property {string} name
 * @property {"create"|"update"|"link"|null} journal   What happens to the journal
 * @property {"create"|"update"|"skip"|null} note      What happens to the map note
 * @property {number} handMadePages   Pages written by hand in a journal that will be updated
 * @property {string[]} missingMedia  Files that could not be found
 * @property {string} [error]
 */

/**
 * Describe what importing would do, without changing anything.
 * @param {object[]} locations
 * @param {object} [options]
 * @param {Scene} [options.scene]       Defaults to the viewed scene
 * @param {string} [options.folder]     Journal folder for new entries
 * @param {boolean} [options.checkMedia=true]  Look for missing image and sound files
 * @returns {Promise<GlimpseImportRow[]>}
 */
export async function planLocations(locations, {scene=canvas.scene, folder: folderName=DEFAULT_FOLDER,
  checkMedia=true}={}) {
  const folder = game.folders.find(f => (f.type === "JournalEntry") && (f.name === folderName)) ?? null;
  const rows = [];
  for ( const loc of locations ) {
    const error = invalid(loc);
    if ( error ) {
      rows.push({id: loc?.id ?? "", name: loc?.name ?? "", journal: null, note: null, handMadePages: 0,
        missingMedia: [], error});
      continue;
    }
    const entry = findEntry(loc, folder);
    const note = findNote(scene, loc, entry);
    const media = [...(loc.images ?? []).flatMap(i => [i?.src, i?.night]), loc.cardImage, loc.cardNightImage, loc.sound]
      .filter(src => (typeof src === "string") && src);
    const missingMedia = [];
    if ( checkMedia ) {
      for ( const src of new Set(media) ) if ( !(await foundry.canvas.srcExists(src)) ) missingMedia.push(src);
    }
    rows.push({
      id: loc.id,
      name: loc.name,
      journal: entry ? (loc.keepJournal ? "link" : "update") : "create",
      note: note ? "update" : (loc.position ? "create" : "skip"),
      handMadePages: (entry && !loc.keepJournal) ? entry.pages.filter(p => !isManaged(p)).length : 0,
      missingMedia
    });
  }
  return rows;
}

/**
 * Create or update journals and map notes for each location. Pages an earlier import made are replaced; pages
 * written by hand are kept. A journal's permission is set when it is made, or when the location names one, and is
 * otherwise left alone, so an import never takes back a journal that was shared when its place was discovered.
 * @param {object[]} locations
 * @param {object} [options]
 * @param {Scene} [options.scene]     Defaults to the viewed scene
 * @param {string} [options.folder]   Journal folder for new entries
 * @returns {Promise<{id: string, ok: boolean, entryId?: string, noteId?: string|null, warning?: string,
 *   error?: string}[]>}
 */
export async function applyLocations(locations, {scene=canvas.scene, folder: folderName=DEFAULT_FOLDER}={}) {
  if ( !game.user.isGM ) throw new Error("Only a GM can import Glimpse places.");
  let folder = game.folders.find(f => (f.type === "JournalEntry") && (f.name === folderName)) ?? null;
  const results = [];
  for ( const loc of locations ) {
    const error = invalid(loc);
    if ( error ) {
      results.push({id: loc?.id ?? "", ok: false, error});
      continue;
    }
    try {
      const named = OWNERSHIP[loc.ownership];
      let entry = findEntry(loc, folder);
      if ( !entry ) {
        folder ??= await Folder.implementation.create({name: folderName, type: "JournalEntry"});
        entry = await JournalEntry.implementation.create({
          name: loc.name, folder: folder.id, ownership: {default: named ?? defaultOwnership(loc)},
          pages: desiredPages(loc), flags: {world: {glimpseLoreId: loc.id}}
        });
      }
      else if ( loc.keepJournal ) {
        if ( !loreId(entry) ) await entry.setFlag("world", "glimpseLoreId", loc.id);
      }
      else {
        const update = {name: loc.name, "flags.world.glimpseLoreId": loc.id};
        if ( named !== undefined ) update["ownership.default"] = named;
        await entry.update(update);
        const managed = entry.pages.filter(isManaged).map(p => p.id);
        if ( managed.length ) await entry.deleteEmbeddedDocuments("JournalEntryPage", managed);
        const pages = desiredPages(loc);
        if ( pages.length ) await entry.createEmbeddedDocuments("JournalEntryPage", pages);
      }

      const flags = {[MODULE_ID]: glimpseFlags(loc), world: {glimpseLoreId: loc.id}};
      let note = findNote(scene, loc, entry);
      if ( note ) {
        const update = {entryId: entry.id, text: loc.label ?? loc.name, flags, ...pinLook(loc)};
        if ( loc.position ) Object.assign(update, {x: loc.position.x, y: loc.position.y});
        await note.update(update);
      }
      else if ( loc.position ) {
        [note] = await scene.createEmbeddedDocuments("Note", [foundry.utils.expandObject({
          entryId: entry.id, x: loc.position.x, y: loc.position.y, text: loc.label ?? loc.name, flags, ...pinLook(loc)
        })]);
      }
      results.push({id: loc.id, ok: true, entryId: entry.id, noteId: note?.id ?? null,
        warning: note ? undefined : "No position given, so no map note was made"});
    } catch(err) {
      results.push({id: loc.id, ok: false, error: err.message});
    }
  }
  await api()?.refresh({clearCache: true});
  return results;
}
