import {LIGHTBOX_TEMPLATE, MODULE_ID, api, flagsOf, loc, setting} from "./constants.mjs";
import {canViewPage, getLocation, isRumoured, noteSource, readPage, regionSource} from "./content.mjs";
import {resolveStyle} from "./card.mjs";

/**
 * A full-screen view of a location: its images large, with the name, facts and a longer excerpt.
 * Used for the double-click gallery and for GM reveals to the whole table.
 */
export class GlimpseLightbox {
  constructor() {
    const el = this.element = document.createElement("div");
    el.id = "glimpse-lightbox";
    el.setAttribute("aria-hidden", "true");
    el.addEventListener("click", this.#onClick.bind(this));
    document.body.append(el);
  }

  /** Bound keydown listener, so it can be removed again. */
  #keyHandler = event => this.#onKeyDown(event);

  /** The location on display. */
  location = null;

  /** Index of the visible slide. */
  #index = 0;

  /** Whether this was pushed to the table by a GM. */
  #revealed = false;

  #seq = 0;

  get isOpen() {
    return this.element.classList.contains("is-open");
  }

  /**
   * Open the lightbox.
   * @param {GlimpseLocation} location
   * @param {object} [options]
   * @param {string} [options.revealedBy]   Name of the GM who revealed it
   */
  async open(location, {revealedBy}={}) {
    const seq = ++this.#seq;
    this.#revealed = !!revealedBy;
    const doc = fromUuidSync(location.uuid);
    const html = await foundry.applications.handlebars.renderTemplate(LIGHTBOX_TEMPLATE, {
      ...location,
      multiple: location.media.length > 1,
      revealedBy: revealedBy ? loc("Lightbox.RevealedBy", {name: revealedBy}) : "",
      canReveal: game.user.isGM && !revealedBy && !!doc,
      labels: {
        prev: loc("Lightbox.Previous"),
        next: loc("Lightbox.Next"),
        close: loc("Lightbox.Close"),
        journal: loc("Lightbox.OpenJournal"),
        reveal: loc("Lightbox.Reveal")
      }
    });
    if ( seq !== this.#seq ) return;

    // Hover cards would sit on top of the lightbox otherwise.
    api()?.hide({immediate: true});
    api()?.regions?.reset();

    this.location = location;
    this.#index = 0;
    const el = this.element;
    el.dataset.style = resolveStyle();
    el.dataset.scanlines = setting("scanlines") ? "on" : "off";
    el.classList.toggle("is-rumoured", !!location.rumoured);
    el.innerHTML = html;
    el.querySelector(".glimpse-lb-slide.is-active video")?.play().catch(() => {});
    void el.offsetWidth;
    el.classList.add("is-open");
    el.setAttribute("aria-hidden", "false");
    window.addEventListener("keydown", this.#keyHandler, {capture: true});
    api()?.sound?.play(location.sound, {boost: 1.5});
  }

  /**
   * Close the lightbox.
   */
  close() {
    if ( !this.isOpen ) return;
    this.#seq++;
    const el = this.element;
    el.classList.remove("is-open");
    el.setAttribute("aria-hidden", "true");
    window.removeEventListener("keydown", this.#keyHandler, {capture: true});
    if ( this.location?.sound ) api()?.sound?.stop();
    this.location = null;
    setTimeout(() => {
      if ( this.isOpen ) return;
      for ( const video of el.querySelectorAll("video") ) video.pause();
      el.innerHTML = "";
    }, 350);
  }

  /**
   * Show a specific slide.
   * @param {number} index
   */
  goTo(index) {
    const slides = Array.from(this.element.querySelectorAll(".glimpse-lb-slide"));
    if ( !slides.length ) return;
    this.#index = (index + slides.length) % slides.length;
    slides.forEach((slide, i) => {
      const active = i === this.#index;
      slide.classList.toggle("is-active", active);
      const video = slide.querySelector("video");
      if ( video ) {
        if ( active ) video.play().catch(() => {});
        else video.pause();
      }
    });
    this.element.querySelectorAll(".glimpse-lb-thumb").forEach((thumb, i) => {
      thumb.classList.toggle("is-active", i === this.#index);
    });
    const slide = slides[this.#index];
    const caption = this.element.querySelector(".glimpse-lb-caption");
    if ( caption ) caption.textContent = slide.dataset.caption ?? "";
    const glow = this.element.querySelector(".glimpse-lb-glow");
    const img = slide.querySelector("img");
    if ( glow && img ) glow.style.backgroundImage = `url("${img.getAttribute("src")}")`;
  }

  /* -------------------------------------------- */

  #onClick(event) {
    const action = event.target.closest("[data-action]")?.dataset.action;
    switch ( action ) {
      case "close": return this.close();
      case "prev": return this.goTo(this.#index - 1);
      case "next": return this.goTo(this.#index + 1);
      case "goto": return this.goTo(Number(event.target.closest("[data-index]").dataset.index));
      case "journal": return this.#openJournal();
      case "reveal": {
        const doc = fromUuidSync(this.location?.uuid);
        if ( doc ) revealToPlayers(doc);
        return;
      }
    }
  }

  /** @param {KeyboardEvent} event */
  #onKeyDown(event) {
    const handled = {Escape: () => this.close(), ArrowLeft: () => this.goTo(this.#index - 1),
      ArrowRight: () => this.goTo(this.#index + 1)}[event.key];
    if ( !handled ) return;
    if ( event.target.closest?.("input, textarea, [contenteditable]") ) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    handled();
  }

  /**
   * Open the full journal the way double-clicking a note normally would.
   */
  #openJournal() {
    const doc = fromUuidSync(this.location?.uuid);
    const entry = doc?.documentName === "Note" ? doc.entry : game.journal.get(flagsOf(doc).entryId);
    const page = doc?.documentName === "Note" ? doc.page : entry?.pages.get(flagsOf(doc).pageId);
    if ( !entry ) return;
    const options = {};
    if ( page ) {
      options.mode = foundry.applications.sheets.journal.JournalEntrySheet.VIEW_MODES.SINGLE;
      options.pageId = page.id;
    }
    this.close();
    entry.sheet.render(true, options);
  }
}

/* -------------------------------------------- */
/*  Gallery and Reveal                          */
/* -------------------------------------------- */

/**
 * Build a Glimpse source for a note or region document.
 * @param {NoteDocument|RegionDocument} doc
 * @returns {GlimpseSource}
 */
export function sourceFor(doc) {
  return doc.documentName === "Region" ? regionSource(doc) : noteSource(doc);
}

/**
 * Open the gallery for a document, for this user only.
 * @param {NoteDocument|RegionDocument} doc
 * @returns {Promise<boolean>}  Whether there was anything to show
 */
export async function openGallery(doc) {
  const location = await getLocation(sourceFor(doc), {excerpt: "long", cache: false});
  if ( !location ) return false;
  await api().lightbox.open(location);
  return true;
}

/**
 * Could this note show a gallery? A fast, synchronous check used to decide whether to replace the
 * journal on double-click.
 * @param {NoteDocument} doc
 * @returns {boolean}
 */
export function noteHasMedia(doc) {
  const flags = flagsOf(doc);
  if ( flags.mode === "off" ) return false;
  if ( !game.user.isGM && isRumoured(noteSource(doc)) ) return false;
  if ( flags.image || flags.nightImage ) return true;
  const pages = doc.page ? [doc.page] : (doc.entry?.pages.contents ?? []);
  return pages.some(p => {
    if ( !canViewPage(p) ) return false;
    const content = readPage(p);
    return !!content.image || /<img\s/i.test(content.html);
  });
}

/**
 * Show a location to every connected player, whatever their permissions: every page except GM-only ones, with secret
 * blocks removed and any rumour lifted. Discovering a rumoured place marks it visited.
 *
 * The card is sent through a world setting rather than the socket, because only GMs can write those, so players
 * know it really came from a GM.
 * @param {NoteDocument|RegionDocument} doc
 */
export async function revealToPlayers(doc) {
  if ( !game.user.isGM ) return;
  const location = await getLocation(sourceFor(doc), {excerpt: "long", secrets: false, reveal: true,
    audience: "table", cache: false});
  if ( !location ) {
    ui.notifications.warn(loc("Lightbox.NothingToReveal"));
    return;
  }
  const payload = {...location, rumourBadge: false};
  await game.settings.set(MODULE_ID, "reveal", {location: payload, time: Date.now()});
  api().lightbox.open(payload, {revealedBy: game.user.name});
  ui.notifications.info(loc("Lightbox.Revealed", {name: location.title}));
  const flags = flagsOf(doc);
  if ( (flags.discovery ?? "known") !== "known" && !flags.visited ) {
    await doc.setFlag(MODULE_ID, "visited", true);
  }
}

/**
 * A GM showed a location to the table.
 * @param {{location: GlimpseLocation, time: number}} value   The new value of the reveal setting
 * @param {string} userId                                      The user who wrote it, as reported by Foundry
 */
export function onRevealChange(value, userId) {
  const lightbox = api()?.lightbox;
  const gm = game.users.get(userId);
  if ( !lightbox || !value?.location || !gm?.isGM || (userId === game.user.id) ) return;
  const location = {...value.location};
  const doc = fromUuidSync(location.uuid, {strict: false});
  location.canOpen = doc ? sourceFor(doc).canOpen : false;
  lightbox.open(location, {revealedBy: gm.name});
}
