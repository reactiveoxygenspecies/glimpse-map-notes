import {TEMPLATE, CARD_WIDTHS, api, flagsOf, loc, setting} from "./constants.mjs";
import {getLocation, noteSource} from "./content.mjs";

/** Space kept between the card and the edges of the screen. */
const MARGIN = 12;

/** Space between the card and the thing it describes. */
const GAP = 14;

/** Grace period after the pointer leaves a note before the card fades. */
const HIDE_DELAY = 90;

/** After a card closes, hovering another note within this window opens it instantly. */
const WARM_WINDOW = 450;

/** How long each image stays up in a slideshow. */
const SLIDE_INTERVAL = 5500;

/** Longest time to wait for the first image before showing the card anyway. */
const PRELOAD_TIMEOUT = 700;

/** Natural aspect ratios of images we have already loaded, keyed by source. */
const ratios = new Map();

/**
 * @typedef GlimpseAnchor
 * A screen rectangle the card sits beside.
 * @property {number} left
 * @property {number} right
 * @property {number} top
 * @property {number} bottom
 * @property {"left"|"right"} [prefer="right"]   The side to try first
 * @property {boolean} [avoidUI=true]            Keep clear of the sidebar and scene controls
 * @property {boolean} [allowVertical=true]      Fall back to above or below when neither side fits
 */

/**
 * @typedef GlimpseTarget
 * What a card is currently describing.
 * @property {string} key                              Identity, used to avoid re-showing the same thing
 * @property {() => GlimpseSource|null} source         Builds a fresh source (documents may have changed)
 * @property {() => GlimpseAnchor|null} [anchor]       Where to place the card
 * @property {Note} [note]                             The note, when the target is a canvas note
 * @property {object} [options]                        Options passed to getLocation
 */

/**
 * A floating location card. The base class renders, animates and positions; subclasses decide when to show.
 */
export class GlimpseCard {
  /**
   * @param {object} options
   * @param {string} options.id             Element id
   * @param {string[]} [options.classes]    Extra classes
   */
  constructor({id, classes=[]}) {
    const el = this.element = document.createElement("div");
    el.id = id;
    el.classList.add("glimpse-card", ...classes);
    el.setAttribute("role", "tooltip");
    el.setAttribute("aria-hidden", "true");
    document.body.append(el);
    window.addEventListener("resize", () => this.schedulePosition(), {passive: true});
  }

  /** @type {GlimpseTarget|null} */
  target = null;

  /** The location currently displayed. */
  location = null;

  /** Increments on every show/hide so that stale async work can bail out. */
  _seq = 0;

  #slideTimer = null;
  #clearTimer = null;
  #frame = null;

  get visible() {
    return this.element.classList.contains("is-visible");
  }

  /* -------------------------------------------- */
  /*  Showing and Hiding                          */
  /* -------------------------------------------- */

  /**
   * Build and reveal the card for a target.
   * @param {GlimpseTarget} target
   * @returns {Promise<boolean>}   Whether the card is now showing this target
   */
  async show(target) {
    const seq = ++this._seq;
    const source = target.source();
    const location = source ? await getLocation(source, target.options) : null;
    if ( seq !== this._seq ) return false;
    if ( api()?.lightbox?.isOpen ) return false; // Never draw over the gallery
    if ( !location ) {
      if ( this.target ) this.hide();
      return false;
    }

    // Wait briefly for the first image so the card opens at its final size.
    const first = location.media[0];
    const ratio = first ? await measure(first) : null;
    if ( (seq !== this._seq) || api()?.lightbox?.isOpen ) return false;

    const context = this._prepareContext(location, target);
    const html = await foundry.applications.handlebars.renderTemplate(TEMPLATE, {
      ...location,
      hint: loc("OpenHint"),
      ...context,
      ratio: clampRatio(ratio, location.layout),
      multiple: location.media.length > 1,
      firstCaption: first?.caption ?? ""
    });
    if ( (seq !== this._seq) || api()?.lightbox?.isOpen ) return false;

    // Swap in the new content.
    const wasVisible = this.visible;
    clearTimeout(this.#clearTimer);
    this.#stopMedia();
    this._onDeactivate();
    this.target = target;
    this.location = location;
    this.#applyAppearance(location);
    this.element.classList.toggle("is-swap", wasVisible);
    this.element.innerHTML = html;
    const body = this.element.querySelector(".glimpse-body");
    if ( body && (body.scrollHeight > body.clientHeight + 2) ) body.classList.add("is-clipped");
    this._onActivate(target, location);
    this.#startMedia();
    this.position();

    // Fade in. The reflow makes sure the starting transform applies before the transition does.
    if ( !wasVisible ) {
      void this.element.offsetWidth;
      this.element.classList.add("is-visible");
      this.element.setAttribute("aria-hidden", "false");
    }
    api()?.sound?.play(location.sound);
    return true;
  }

  /**
   * Fade the card out.
   * @param {object} [options]
   * @param {boolean} [options.immediate]   Skip the fade.
   */
  hide({immediate=false}={}) {
    this._seq++;
    this._onDeactivate();
    if ( !this.target && !this.visible ) return;
    if ( this.location?.sound ) api()?.sound?.stop();
    this.target = null;
    this.location = null;
    this._closedAt = Date.now();
    this.element.classList.remove("is-visible", "is-swap");
    this.element.setAttribute("aria-hidden", "true");
    clearTimeout(this.#slideTimer);

    // Empty the card once it has faded so videos stop and memory is released.
    const clear = () => {
      if ( this.visible ) return;
      this.#stopMedia();
      this.element.innerHTML = "";
    };
    if ( immediate ) clear();
    else this.#clearTimer = setTimeout(clear, 260);
  }

  /** When the card last closed. */
  _closedAt = 0;

  /**
   * Re-render the current card, for example after its journal changed or a setting was edited.
   * @returns {Promise<void>}
   */
  async refresh() {
    const target = this.target;
    if ( !target ) return;
    if ( !setting("enabled") ) return this.hide({immediate: true});
    await this.show(target);
  }

  /**
   * Extra template data for subclasses.
   * @param {GlimpseLocation} location
   * @param {GlimpseTarget} target
   * @returns {object}
   * @protected
   */
  _prepareContext(location, target) {
    const footer = location.canOpen || (location.media.length > 1) || location.media.some(m => m.caption);
    return {showFooter: footer, showFacts: location.facts.length > 0};
  }

  /**
   * Called after new content is inserted.
   * @protected
   */
  _onActivate(target, location) {}

  /**
   * Called before content is replaced or hidden.
   * @protected
   */
  _onDeactivate() {}

  /* -------------------------------------------- */
  /*  Positioning                                 */
  /* -------------------------------------------- */

  /**
   * Request a reposition on the next animation frame.
   */
  schedulePosition() {
    if ( this.#frame || !this.target ) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = null;
      this.position();
    });
  }

  /**
   * Place the card beside its anchor, flipping sides and clamping so it always stays on screen.
   */
  position() {
    const anchor = this.target?.anchor?.();
    if ( !anchor ) return;
    const el = this.element;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const {prefer="right", avoidUI=true, allowVertical=true} = anchor;
    const cy = (anchor.top + anchor.bottom) / 2;

    // Usable area, keeping clear of the sidebar and scene controls when anchored to the canvas.
    let minX = MARGIN;
    let maxX = window.innerWidth - MARGIN;
    const minY = MARGIN;
    const maxY = window.innerHeight - MARGIN;
    if ( avoidUI ) {
      const sidebar = document.getElementById("sidebar")?.getBoundingClientRect();
      if ( sidebar?.width ) maxX = Math.min(maxX, sidebar.left - MARGIN);
      const controls = document.getElementById("scene-controls")?.getBoundingClientRect();
      if ( controls?.width ) minX = Math.max(minX, controls.right + MARGIN);
    }

    // Choose a side: the preferred one if the card fits, otherwise whichever has more room.
    const space = {right: maxX - (anchor.right + GAP), left: (anchor.left - GAP) - minX};
    let side = prefer;
    const other = side === "right" ? "left" : "right";
    if ( (space[side] < w) && ((space[other] >= w) || (space[other] > space[side])) ) side = other;

    let x = side === "right" ? anchor.right + GAP : anchor.left - GAP - w;
    x = Math.clamp(x, minX, Math.max(minX, maxX - w));

    // Sit slightly above center, which reads more naturally than dead center.
    let y = cy - (h * 0.42);
    y = Math.clamp(y, minY, Math.max(minY, maxY - h));

    // If clamping pushed the card over the anchor, move it below or above instead.
    const overlapsX = (x < anchor.right + GAP) && (x + w > anchor.left - GAP);
    if ( overlapsX && allowVertical ) {
      const below = anchor.bottom + GAP;
      const above = anchor.top - GAP - h;
      if ( below + h <= maxY ) y = below;
      else if ( above >= minY ) y = above;
      side = y > cy ? "below" : "above";
    }

    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
    el.dataset.side = side;
  }

  /* -------------------------------------------- */
  /*  Appearance                                  */
  /* -------------------------------------------- */

  /**
   * Apply settings-driven classes and variables to the card element.
   * @param {GlimpseLocation} location
   */
  #applyAppearance(location) {
    const el = this.element;
    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const size = location.size ?? setting("size");
    el.dataset.style = resolveStyle();
    el.dataset.layout = location.layout;
    el.dataset.size = size;
    el.dataset.motion = (setting("motion") && !reduceMotion) ? "on" : "off";
    el.classList.toggle("is-rumoured", location.rumoured);
    el.style.setProperty("--glimpse-width", `${CARD_WIDTHS[size] ?? CARD_WIDTHS.medium}px`);
    el.style.setProperty("--glimpse-scale", String((setting("textScale") ?? 100) / 100));
  }

  /* -------------------------------------------- */
  /*  Media and Slideshow                         */
  /* -------------------------------------------- */

  #startMedia() {
    const slides = this.element.querySelectorAll(".glimpse-slide");
    for ( const slide of slides ) {
      const img = slide.querySelector("img");
      if ( img && !img.complete ) {
        slide.classList.add("is-loading");
        img.addEventListener("load", () => slide.classList.remove("is-loading"), {once: true});
        img.addEventListener("error", () => slide.classList.remove("is-loading"), {once: true});
      }
    }
    slides[0]?.querySelector("video")?.play().catch(() => {});
    clearTimeout(this.#slideTimer);
    if ( (slides.length > 1) && setting("slideshow") ) this.#scheduleSlide();
  }

  #scheduleSlide() {
    this.#slideTimer = setTimeout(() => {
      this.#advanceSlide();
      this.#scheduleSlide();
    }, SLIDE_INTERVAL);
  }

  #advanceSlide() {
    const slides = Array.from(this.element.querySelectorAll(".glimpse-slide"));
    if ( slides.length < 2 ) return;
    const current = slides.findIndex(s => s.classList.contains("is-active"));
    const nextIndex = (current + 1) % slides.length;
    slides.forEach((slide, i) => {
      const active = i === nextIndex;
      slide.classList.toggle("is-active", active);
      const video = slide.querySelector("video");
      if ( video ) {
        if ( active ) video.play().catch(() => {});
        else video.pause();
      }
    });
    this.element.querySelectorAll(".glimpse-dots i").forEach((dot, i) => {
      dot.classList.toggle("is-active", i === nextIndex);
    });
    const caption = this.element.querySelector(".glimpse-caption");
    if ( caption ) caption.textContent = slides[nextIndex].dataset.caption ?? "";
  }

  #stopMedia() {
    clearTimeout(this.#slideTimer);
    for ( const video of this.element.querySelectorAll("video") ) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
  }
}

/* -------------------------------------------- */
/*  Note Card                                   */
/* -------------------------------------------- */

/**
 * The card shown while a map note is hovered, or while previewing a note's configuration.
 */
export class NoteCard extends GlimpseCard {
  constructor() {
    super({id: "glimpse-card"});
  }

  /** The note waiting for its hover delay. */
  #pending = null;

  #showTimer = null;
  #hideTimer = null;

  /** The note tooltip we hid, so it can be restored. */
  #hiddenLabel = null;

  /** The note currently shown on the canvas, if any. */
  get note() {
    return this.target?.note ?? null;
  }

  /**
   * The pointer entered a note (on the canvas or in the Notes sidebar).
   * @param {Note} note
   */
  hoverIn(note) {
    if ( !setting("enabled") || note.isPreview ) return;
    if ( flagsOf(note.document).mode === "off" ) return;
    clearTimeout(this.#hideTimer);
    if ( (note === this.note) && this.visible ) return;
    clearTimeout(this.#showTimer);
    this.#pending = note;
    const warm = this.visible || ((Date.now() - this._closedAt) < WARM_WINDOW);
    const delay = warm ? 0 : setting("delay");
    if ( delay > 0 ) this.#showTimer = setTimeout(() => this.showNote(note), delay);
    else this.showNote(note);
  }

  /**
   * The pointer left a note.
   * @param {Note} note
   */
  hoverOut(note) {
    const wasPending = this.#pending === note;
    if ( wasPending ) {
      clearTimeout(this.#showTimer);
      this.#pending = null;
      this._seq++;
    }
    // Hide whatever is on screen: either this note's card, or the previous note's card that was about to be
    // replaced by this one.
    if ( (this.note === note) || (wasPending && this.target) ) {
      clearTimeout(this.#hideTimer);
      this.#hideTimer = setTimeout(() => this.hide(), HIDE_DELAY);
    }
  }

  /**
   * Show the card for a canvas note.
   * @param {Note} note
   * @returns {Promise<boolean>}
   */
  async showNote(note) {
    const shown = await this.show({
      key: note.document.uuid,
      note,
      source: () => (note.destroyed ? null : noteSource(note.document)),
      anchor: () => noteAnchor(note)
    });
    if ( this.#pending === note ) this.#pending = null;
    return shown;
  }

  /**
   * Show a preview of a note configuration beside its sheet.
   * @param {NoteDocument} doc        A temporary copy of the note with unsaved changes applied
   * @param {HTMLElement} element     The configuration window
   */
  async showPreview(doc, element) {
    clearTimeout(this.#hideTimer);
    return this.show({
      key: `preview:${doc.uuid}`,
      source: () => noteSource(doc),
      options: {cache: false},
      anchor: () => {
        const r = element.getBoundingClientRect();
        return {left: r.left, right: r.right, top: r.top, bottom: r.top + Math.min(r.height, 360), avoidUI: false,
          allowVertical: false};
      }
    });
  }

  /** @override */
  hide(options) {
    clearTimeout(this.#showTimer);
    clearTimeout(this.#hideTimer);
    this.#pending = null;
    super.hide(options);
  }

  /** @override */
  async refresh() {
    if ( this.#pending ) return;
    if ( this.note?.destroyed ) return this.hide({immediate: true});
    return super.refresh();
  }

  /** @override */
  _prepareContext(location, target) {
    const context = super._prepareContext(location, target);
    context.travel = target.note ? travelInfo(location.point) : null;
    context.showFacts ||= !!context.travel;
    if ( (setting("doubleClick") === "gallery") && location.media.length ) context.hint = loc("GalleryHint");
    return context;
  }

  /**
   * Hide the note's own canvas label while the card is open. Core resets `visible` on every state refresh,
   * so `renderable` is used instead.
   * @override
   */
  _onActivate(target) {
    const label = target.note?.tooltip;
    if ( !setting("hideLabel") || !label || label.destroyed ) return;
    label.renderable = false;
    this.#hiddenLabel = label;
  }

  /** @override */
  _onDeactivate() {
    const label = this.#hiddenLabel;
    this.#hiddenLabel = null;
    if ( label && !label.destroyed ) label.renderable = true;
  }
}

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

/**
 * Find the on-screen rectangle a note's card should sit beside.
 * @param {Note} note
 * @returns {GlimpseAnchor|null}
 */
function noteAnchor(note) {
  // Hovering an entry in the V14 Notes sidebar list: anchor to that row.
  const row = document.querySelector(`.placeable-entry.note.hovered[data-entry-id="${note.id}"]`);
  const rect = row?.getBoundingClientRect();
  if ( rect?.width ) {
    return {left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, prefer: "left", avoidUI: false,
      allowVertical: false};
  }

  // Otherwise anchor to the note icon on the canvas.
  if ( note.destroyed || !canvas.ready ) return null;
  // Work from the document's position rather than the sprite's, which can lag a frame behind.
  const view = canvas.app.view.getBoundingClientRect();
  const p = canvas.stage.toGlobal({x: note.document.x, y: note.document.y});
  const r = Math.max((note.document.iconSize / 2) * canvas.stage.scale.x, 8);
  const cx = view.left + p.x;
  const cy = view.top + p.y;
  return {left: cx - r, right: cx + r, top: cy - r, bottom: cy + r};
}

/**
 * Describe how far the user's token is from a point.
 * @param {{x: number, y: number}|null} point
 * @returns {string|null}
 */
function travelInfo(point) {
  if ( !point || !setting("travel") || !canvas.ready ) return null;
  const token = canvas.tokens.controlled[0] ?? game.user.character?.getActiveTokens()[0];
  if ( !token ) return null;
  const {distance} = canvas.grid.measurePath([token.center, point]);
  if ( !(distance > canvas.grid.distance) ) return null;
  const units = canvas.grid.units || "";
  const round = n => (n >= 100 ? Math.round(n) : Math.round(n * 10) / 10).toLocaleString(game.i18n.lang);
  let text = `${round(distance)} ${units}`.trim();
  const perDay = setting("travelPerDay");
  if ( perDay > 0 ) {
    const days = distance / perDay;
    if ( days < 0.75 ) text += ` · ${loc("Travel.UnderADay")}`;
    else {
      const half = Math.round(days * 2) / 2;
      text += ` · ${loc(half === 1 ? "Travel.Day" : "Travel.Days", {days: half.toLocaleString(game.i18n.lang)})}`;
    }
  }
  return text;
}

/**
 * The card palette to use.
 * @returns {"dusk"|"parchment"}
 */
export function resolveStyle() {
  const style = setting("style");
  if ( style !== "auto" ) return style;
  return document.getElementById("interface")?.classList.contains("theme-light") ? "parchment" : "dusk";
}

/**
 * Clamp a natural image ratio so cards never become too tall or too thin.
 * @param {number|null} ratio   Width divided by height
 * @param {string} layout
 * @returns {number}
 */
export function clampRatio(ratio, layout) {
  const fallback = 16 / 10;
  if ( !ratio || !Number.isFinite(ratio) ) return fallback;
  const [min, max] = layout === "image" ? [0.8, 2.2] : [1.2, 1.6];
  return Math.round(Math.clamp(ratio, min, max) * 1000) / 1000;
}

/**
 * Load a media file far enough to know its aspect ratio, without waiting forever.
 * @param {GlimpseMedia} media
 * @returns {Promise<number|null>}
 */
export async function measure(media) {
  if ( ratios.has(media.src) ) return ratios.get(media.src);
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), PRELOAD_TIMEOUT));
  const load = new Promise(resolve => {
    if ( media.isVideo ) {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      video.onloadedmetadata = () => resolve(video.videoWidth / video.videoHeight);
      video.onerror = () => resolve(null);
      video.src = media.src;
    } else {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(img.naturalWidth / img.naturalHeight);
      img.onerror = () => resolve(null);
      img.src = media.src;
    }
  }).then(ratio => {
    if ( ratio ) ratios.set(media.src, ratio);
    return ratio;
  });
  return Promise.race([load, timeout]);
}
