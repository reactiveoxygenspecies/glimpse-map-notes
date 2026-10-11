import {api, setting} from "./constants.mjs";
import {GlimpseCard} from "./card.mjs";
import {regionEnabled, regionSource} from "./content.mjs";

/** How long the pointer must rest in a region before its banner appears. */
const DWELL = 450;

/** Switching between regions while a banner is open is quicker. */
const SWITCH_DWELL = 150;

/** Grace period after leaving a region. */
const LEAVE_DELAY = 250;

/**
 * A wide banner describing the region under the pointer, shown low on the screen.
 */
export class RegionBanner extends GlimpseCard {
  constructor() {
    super({id: "glimpse-banner", classes: ["glimpse-banner"]});
  }

  /** @override */
  _prepareContext(location, target) {
    const context = super._prepareContext(location, target);
    context.showFooter = (location.media.length > 1) || location.media.some(m => m.caption);
    context.canOpen = false;
    return context;
  }

  /**
   * Center the banner horizontally between the scene controls and the sidebar, just above the hotbar.
   * @override
   */
  position() {
    if ( !this.target ) return;
    const el = this.element;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const controls = document.getElementById("scene-controls")?.getBoundingClientRect();
    const sidebar = document.getElementById("sidebar")?.getBoundingClientRect();
    const hotbar = document.getElementById("hotbar")?.getBoundingClientRect();
    const left = controls?.width ? controls.right : 0;
    const right = sidebar?.width ? sidebar.left : window.innerWidth;
    const bottom = hotbar?.height ? hotbar.top : window.innerHeight;
    const x = Math.max(12, left + ((right - left - w) / 2));
    const y = Math.max(12, bottom - h - 18);
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
    el.dataset.side = "above";
  }
}

/**
 * Watches the pointer over the canvas and shows the banner for the region beneath it.
 */
export class RegionTracker {
  /** @param {RegionBanner} banner */
  constructor(banner) {
    this.banner = banner;
  }

  /** The region the pointer is in, or null. */
  #region = null;

  /** Last pointer position in client coordinates. */
  #client = null;

  #peeking = false;
  #frame = null;
  #showTimer = null;
  #hideTimer = null;

  /**
   * Start listening to the canvas. Safe to call once per session.
   */
  attach() {
    const view = canvas.app.view;
    view.addEventListener("pointermove", event => {
      this.#client = {x: event.clientX, y: event.clientY};
      this.schedule();
    }, {passive: true});
    view.addEventListener("pointerleave", () => {
      this.#client = null;
      this.schedule();
    }, {passive: true});
  }

  /**
   * Re-evaluate on the next frame.
   */
  schedule() {
    if ( this.#frame ) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = null;
      this.#evaluate();
    });
  }

  /**
   * Hold-to-peek, for the "while holding a key" mode.
   * @param {boolean} value
   */
  setPeeking(value) {
    this.#peeking = value;
    this.#region = null;
    this.#evaluate();
  }

  /**
   * Forget the current region and hide the banner.
   */
  reset() {
    this.#region = null;
    clearTimeout(this.#showTimer);
    clearTimeout(this.#hideTimer);
    this.banner.hide();
  }

  #evaluate() {
    const mode = setting("regionMode");
    const noteOpen = !!api()?.card?.target;
    const active = setting("enabled") && (mode !== "off") && ((mode === "hover") || this.#peeking) && !noteOpen;
    const region = (active && this.#client && canvas.ready) ? this.#regionAt(this.#client) : null;
    if ( region === this.#region ) {
      if ( region ) clearTimeout(this.#hideTimer);
      return;
    }
    this.#region = region;
    clearTimeout(this.#showTimer);
    clearTimeout(this.#hideTimer);

    if ( !region ) {
      if ( noteOpen || !active ) this.banner.hide({immediate: noteOpen});
      else this.#hideTimer = setTimeout(() => this.banner.hide(), LEAVE_DELAY);
      return;
    }

    const delay = (mode === "key") ? 0 : (this.banner.visible ? SWITCH_DWELL : DWELL);
    this.#showTimer = setTimeout(() => {
      if ( this.#region !== region ) return;
      this.banner.show({
        key: region.document.uuid,
        source: () => (region.destroyed ? null : regionSource(region.document)),
        anchor: () => null
      });
    }, delay);
  }

  /**
   * The most specific Glimpse-enabled region under a client position.
   * @param {{x: number, y: number}} client
   * @returns {Region|null}
   */
  #regionAt(client) {
    const point = canvas.canvasCoordinatesFromClient(client);
    const levelId = canvas.level?.id;
    let best = null;
    let bestArea = Infinity;
    for ( const region of canvas.regions.placeables ) {
      const doc = region.document;
      if ( !regionEnabled(doc) ) continue;
      if ( doc.hidden && !game.user.isGM ) continue;
      if ( levelId && doc.includedInLevel && !doc.includedInLevel(levelId) ) continue;
      if ( !doc.polygonTree.testPoint(point) ) continue;
      const {width, height} = region.bounds;
      const area = width * height;
      if ( area < bestArea ) {
        best = region;
        bestArea = area;
      }
    }
    return best;
  }
}
