import {MODULE_ID, loc, setting} from "./constants.mjs";
import {ICON_CATEGORIES, ICON_SET} from "./icon-set.mjs";

/** Folder holding the Glimpse icon set. */
export const ICON_PATH = `modules/${MODULE_ID}/icons/`;

/**
 * Every icon the picker offers: the Glimpse set followed by Foundry's own note icons.
 * @returns {{src: string, label: string, category: string, group: "glimpse"|"foundry"}[]}
 */
export function allIcons() {
  const glimpse = ICON_SET.map(({id, category}) => ({
    src: `${ICON_PATH}${id}.svg`, label: iconLabel(id), category, group: "glimpse"
  }));
  const foundry = Object.entries(CONFIG.JournalEntry.noteIcons).map(([label, src]) => ({
    src, label: game.i18n.localize(label), category: "foundry", group: "foundry"
  })).sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));
  return [...glimpse, ...foundry];
}

/**
 * A CSS url() for an icon path. Relative URLs inside CSS custom properties resolve against the stylesheet that uses
 * them, not the page, so paths must be made absolute first.
 * @param {string} src
 * @returns {string}
 */
export function cssUrl(src) {
  if ( !src ) return "none";
  return `url("${new URL(src, document.baseURI).href.replace(/"/g, "%22")}")`;
}

/**
 * The display name of a Glimpse icon.
 * @param {string} id
 * @returns {string}
 */
export function iconLabel(id) {
  const key = `GLIMPSE.Icons.${id}`;
  return game.i18n.has(key) ? game.i18n.localize(key) : id.replace(/(^|-)(\w)/g, (m, s, c) => (s ? " " : "") + c.toUpperCase());
}

/**
 * If a path belongs to the Glimpse set, its id.
 * @param {string} src
 * @returns {string|null}
 */
export function glimpseIconId(src) {
  if ( !src?.startsWith(ICON_PATH) ) return null;
  const id = src.slice(ICON_PATH.length).replace(/\.svg$/, "");
  return ICON_SET.some(i => i.id === id) ? id : null;
}

/**
 * A window showing every available map icon as it will look on the map, with the note's tint and the world's
 * icon background style.
 */
export class IconPicker extends foundry.applications.api.ApplicationV2 {
  /**
   * @param {object} options
   * @param {string} [options.current]            The icon currently chosen
   * @param {string} [options.tint]               The note's tint, as a CSS color
   * @param {(src: string) => void} options.onPick  Called with the chosen icon path
   */
  constructor({current, tint, onPick, ...options} = {}) {
    super(options);
    this.current = current ?? "";
    this.tint = tint || "#ffffff";
    this.onPick = onPick;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "glimpse-icon-picker",
    classes: ["glimpse-icon-picker"],
    window: {title: "GLIMPSE.Picker.Title", icon: "fa-solid fa-icons", resizable: true},
    position: {width: 700, height: 640}
  };

  /** Search text. */
  #query = "";

  /** Category filter: "all", a Glimpse category, or "foundry". */
  #category = "all";

  /** Preview backdrop: "light" or "dark". */
  #backdrop = "light";

  /** @override */
  async _renderHTML() {
    const esc = foundry.utils.escapeHTML;
    const chips = ["all", ...ICON_CATEGORIES, "foundry"].map(c => `
      <button type="button" class="glimpse-chip${c === this.#category ? " is-active" : ""}" data-category="${c}">
        ${esc(loc(`Picker.Categories.${c}`))}</button>`).join("");
    const style = setting("iconBackground");
    const tiles = allIcons().map(icon => `
      <button type="button" class="glimpse-icon-tile${icon.src === this.current ? " is-current" : ""}"
              data-src="${esc(icon.src)}" data-category="${icon.category}" data-label="${esc(icon.label.toLowerCase())}"
              data-tooltip="${esc(icon.label)}" aria-label="${esc(icon.label)}">
        <span class="glimpse-icon-swatch" data-style="${style}">
          <span class="glimpse-icon-art" style="--icon: ${esc(cssUrl(icon.src))}; --tint: ${esc(this.tint)}"></span>
        </span>
        <span class="glimpse-icon-name">${esc(icon.label)}</span>
      </button>`).join("");
    return `
      <div class="glimpse-picker-bar">
        <input type="search" class="glimpse-picker-search" placeholder="${esc(loc("Picker.Search"))}"
               value="${esc(this.#query)}" aria-label="${esc(loc("Picker.Search"))}">
        <div class="glimpse-picker-backdrop" role="group" aria-label="${esc(loc("Picker.Backdrop"))}">
          <button type="button" data-backdrop="light" class="${this.#backdrop === "light" ? "is-active" : ""}"
                  data-tooltip="${esc(loc("Picker.Light"))}"><i class="fa-solid fa-sun"></i></button>
          <button type="button" data-backdrop="dark" class="${this.#backdrop === "dark" ? "is-active" : ""}"
                  data-tooltip="${esc(loc("Picker.Dark"))}"><i class="fa-solid fa-moon"></i></button>
        </div>
      </div>
      <nav class="glimpse-picker-chips">${chips}</nav>
      <div class="glimpse-picker-grid" data-backdrop="${this.#backdrop}">${tiles}</div>
      <p class="glimpse-picker-empty" hidden>${esc(loc("Picker.Empty"))}</p>`;
  }

  /** @override */
  _replaceHTML(html, content) {
    content.innerHTML = html;
    this.#activate(content);
  }

  /**
   * Wire up the search box, filters and tiles.
   * @param {HTMLElement} content
   */
  #activate(content) {
    const search = content.querySelector(".glimpse-picker-search");
    search.addEventListener("input", () => {
      this.#query = search.value;
      this.#filter(content);
    });
    for ( const chip of content.querySelectorAll(".glimpse-chip") ) {
      chip.addEventListener("click", () => {
        this.#category = chip.dataset.category;
        content.querySelectorAll(".glimpse-chip").forEach(c => c.classList.toggle("is-active", c === chip));
        this.#filter(content);
      });
    }
    for ( const button of content.querySelectorAll("[data-backdrop] > button, .glimpse-picker-backdrop button") ) {
      button.addEventListener("click", () => {
        this.#backdrop = button.dataset.backdrop;
        content.querySelector(".glimpse-picker-grid").dataset.backdrop = this.#backdrop;
        content.querySelectorAll(".glimpse-picker-backdrop button").forEach(b => b.classList.toggle("is-active", b === button));
      });
    }
    for ( const tile of content.querySelectorAll(".glimpse-icon-tile") ) {
      tile.addEventListener("click", () => this.#pick(tile.dataset.src));
    }
    this.#filter(content);
    content.querySelector(".glimpse-icon-tile.is-current")?.scrollIntoView({block: "center"});
    search.focus();
  }

  /**
   * Show only tiles matching the search and category.
   * @param {HTMLElement} content
   */
  #filter(content) {
    const query = this.#query.trim().toLowerCase();
    let shown = 0;
    for ( const tile of content.querySelectorAll(".glimpse-icon-tile") ) {
      const inCategory = (this.#category === "all") || (tile.dataset.category === this.#category);
      const matches = !query || tile.dataset.label.includes(query);
      tile.hidden = !(inCategory && matches);
      if ( !tile.hidden ) shown++;
    }
    content.querySelector(".glimpse-picker-empty").hidden = shown > 0;
  }

  /**
   * Choose an icon and close.
   * @param {string} src
   */
  #pick(src) {
    this.onPick?.(src);
    this.close();
  }
}
