import {MODULE_ID, SOCKET, flagsOf, setting} from "./constants.mjs";
import {isRumoured, noteSource, regionEnabled, regionSource} from "./content.mjs";

/**
 * Sharing journals when places are discovered. A rumoured place can keep its journal private, since Glimpse keeps
 * its note on the map anyway; once the place is discovered, its journal is shared at the level the GM chose.
 *
 *  - The GM marking a place discovered (in the note, from the context menu or by showing it) shares it with everyone.
 *  - A player exploring a place that is "rumoured until explored" has it shared with them only, because each player
 *    explores their own fog of war. Only their client knows, so it asks an active GM's client to do it.
 */

/**
 * The permission level discovered places are shared at, or null when sharing is off.
 * @returns {number|null}
 */
function shareLevel() {
  const level = CONST.DOCUMENT_OWNERSHIP_LEVELS[setting("shareOnDiscovery").toUpperCase()];
  return level > CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE ? level : null;
}

/**
 * Describe a note or region as a Glimpse source.
 * @param {NoteDocument|RegionDocument} doc
 * @returns {GlimpseSource}
 */
function sourceOf(doc) {
  return doc.documentName === "Region" ? regionSource(doc) : noteSource(doc);
}

/**
 * The permission everyone has on a document, following inherited levels up to the parent.
 * @param {JournalEntry|JournalEntryPage} doc
 * @returns {number}
 */
export function defaultLevel(doc) {
  const level = doc.ownership.default ?? CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
  if ( (level === CONST.DOCUMENT_OWNERSHIP_LEVELS.INHERIT) && doc.parent ) return defaultLevel(doc.parent);
  return level;
}

/**
 * Share the journal a place links to: the page, when it points at a single page, else the whole entry. Permissions
 * are only ever raised, and pages whose own permission is None stay private, as they do when a place is shown to
 * the table.
 * @param {NoteDocument|RegionDocument} doc
 * @param {User} [user]   Share with this player only, rather than with everyone
 * @returns {Promise<void>}
 */
export async function shareJournal(doc, user) {
  const level = shareLevel();
  const source = sourceOf(doc);
  const journal = source.page ?? source.entry;
  if ( !game.user.isGM || !level || !journal ) return;
  const current = user ? journal.getUserLevel(user) : defaultLevel(journal);
  if ( current >= level ) return;
  await journal.update({[`ownership.${user?.id ?? "default"}`]: level});
}

/**
 * This GM marked a place discovered: share its journal with everyone.
 * @param {NoteDocument|RegionDocument} doc
 * @param {object} changes
 * @param {object} options
 * @param {string} userId
 */
export function onDiscovered(doc, changes, options, userId) {
  if ( userId !== game.user.id ) return;
  const path = `flags.${MODULE_ID}.visited`;
  if ( (changes[path] ?? foundry.utils.getProperty(changes, path)) !== true ) return;
  if ( (flagsOf(doc).discovery ?? "known") === "known" ) return;
  shareJournal(doc);
}

/** Places this player has already reported as explored this session. */
const reported = new Set();

/**
 * Tell the GM about places this player has explored since the last check. Runs after vision refreshes, once they
 * settle.
 */
export const reportExplored = foundry.utils.debounce(() => {
  const level = shareLevel();
  // With no GM online nobody could act on the report, so wait and try again after a later refresh.
  if ( game.user.isGM || !level || !canvas.ready || !game.users.activeGM ) return;
  const docs = [
    ...canvas.notes.placeables.map(n => n.document),
    ...canvas.regions.placeables.map(r => r.document).filter(regionEnabled)
  ];
  for ( const doc of docs ) {
    const flags = flagsOf(doc);
    if ( (flags.discovery !== "explore") || flags.visited || (flags.mode === "off") || reported.has(doc.uuid) ) continue;
    const source = sourceOf(doc);
    if ( isRumoured(source) ) continue;
    reported.add(doc.uuid);
    const journal = source.page ?? source.entry;
    if ( journal?.testUserPermission(game.user, level) ) continue;
    game.socket.emit(SOCKET, {action: "explored", uuid: doc.uuid, userId: game.user.id});
  }
}, 1000);

/**
 * Handle messages from other clients. One active GM acts on them.
 *
 * A player could claim to have explored a place they have not. That only shares a place meant to be found by
 * exploring with a player who is not there yet, so the claim is not checked against their fog of war.
 * @param {object} message
 */
export function onSocketMessage(message) {
  if ( (message?.action !== "explored") || (game.users.activeGM !== game.user) ) return;
  const user = game.users.get(message.userId);
  const doc = fromUuidSync(message.uuid, {strict: false});
  if ( !user || user.isGM || !["Note", "Region"].includes(doc?.documentName) ) return;
  if ( flagsOf(doc).discovery !== "explore" ) return;
  shareJournal(doc, user);
}
