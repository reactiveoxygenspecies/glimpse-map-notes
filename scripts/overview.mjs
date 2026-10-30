import {MODULE_ID, flagsOf, loc} from "./constants.mjs";
import {noteSource, readPage, regionSource} from "./content.mjs";
import {defaultLevel} from "./discovery.mjs";
import {openGallery, revealToPlayers} from "./lightbox.mjs";
import {applyLocations, exportLocations, manifestLocations, planLocations} from "./manifest.mjs";
import GlimpseBannerBehavior from "./behavior.mjs";

const LEVELS = CONST.DOCUMENT_OWNERSHIP_LEVELS;

/**
 * @typedef GlimpsePlaceRow
 * @property {NoteDocument|RegionDocument} doc
 * @property {"note"|"region"} kind
 * @property {string} name
 * @property {string} journal          Name of the linked journal, or ""
 * @property {"known"|"rumour"|"explore"|"discovered"} status
 * @property {number|null} access      What every player may do with the journal, or null without one
 * @property {number} images
 * @property {boolean} text
 * @property {string[]} issues         Localization keys under GLIMPSE.Overview.Issues
 */

/**
 * Everything the overview shows about one place, as the GM sees it.
 * @param {NoteDocument|RegionDocument} doc
 * @returns {GlimpsePlaceRow}
 */
export function describePlace(doc) {
  const kind = doc.documentName === "Region" ? "region" : "note";
  const flags = flagsOf(doc);
  const source = kind === "region" ? regionSource(doc) : noteSource(doc);
  const {entry, page} = source;
  const pages = page ? [page] : (entry?.pages.contents ?? []);
  const contents = pages.map(p => readPage(p));
  const images = (flags.image ? 1 : 0) + contents.filter(c => c.image).length
    + contents.reduce((n, c) => n + (c.html.match(/<img\s/gi)?.length ?? 0), 0);
  const text = contents.some(c => c.html.replace(/<[^>]*>/g, "").trim());
  const discovery = flags.discovery ?? "known";
  const status = (discovery === "known") ? "known" : (flags.visited ? "discovered" : discovery);
  const journal = page ?? entry;
  const access = journal ? defaultLevel(journal) : null;
  const mode = flags.mode ?? "auto";

  const issues = [];
  if ( mode === "off" ) issues.push("Off");
  else {
    if ( !images && (mode !== "text") ) issues.push("NoImage");
    if ( !text && (mode !== "image") ) issues.push("NoText");
  }
  if ( ["rumour", "explore"].includes(status) && (access >= LEVELS.OBSERVER) ) issues.push("Readable");
  if ( (kind === "note") && (status === "known") ) {
    if ( !journal ) issues.push("NoJournal");
    else if ( access < LEVELS.LIMITED ) issues.push("Hidden");
  }
  return {doc, kind, name: source.title, journal: journal?.name ?? "", status, access, images, text, issues};
}

/**
 * Every place on a scene the overview lists: its map notes, and the regions with a Glimpse or a Glimpse banner
 * behavior.
 * @param {Scene} scene
 * @returns {GlimpsePlaceRow[]}
 */
export function scenePlaces(scene) {
  const regions = scene.regions.filter(r => !!flagsOf(r).enabled
    || r.behaviors.some(b => b.type === GlimpseBannerBehavior.TYPE));
  return [...scene.notes.contents, ...regions].map(describePlace)
    .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
}

/** Re-render the overview if it is open, once a burst of changes settles. */
export const refreshOverview = foundry.utils.debounce(() => {
  const app = foundry.applications.instances.get("glimpse-overview");
  if ( app?.rendered ) app.render();
}, 150);

/**
 * Open the overview, or bring it to the front.
 * @returns {GlimpseOverview}
 */
export function openOverview() {
  const app = foundry.applications.instances.get("glimpse-overview") ?? new GlimpseOverview();
  app.render({force: true});
  return app;
}

/**
 * A GM window listing every Glimpse place on the viewed scene, what players get from it, and what it is missing.
 * Places can be marked discovered in bulk, and the scene's notes exported to and imported from JSON.
 */
export class GlimpseOverview extends foundry.applications.api.ApplicationV2 {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: "glimpse-overview",
    classes: ["glimpse-overview"],
    window: {title: "GLIMPSE.Overview.Title", icon: "fa-solid fa-map-location-dot", resizable: true},
    position: {width: 860, height: 640}
  };

  /** "all", "rumoured" or "issues". */
  #filter = "all";

  #query = "";

  /** Selected places, by UUID, kept across renders. */
  #selected = new Set();

  /** Rows by UUID, from the last render. */
  #rows = new Map();

  /** @override */
  async _renderHTML() {
    const esc = foundry.utils.escapeHTML;
    if ( !canvas.ready || !canvas.scene ) return `<p class="glimpse-overview-empty">${esc(loc("Overview.NoScene"))}</p>`;
    const rows = scenePlaces(canvas.scene);
    this.#rows = new Map(rows.map(r => [r.doc.uuid, r]));
    for ( const uuid of this.#selected ) if ( !this.#rows.has(uuid) ) this.#selected.delete(uuid);

    const counts = {
      all: rows.length,
      rumoured: rows.filter(r => ["rumour", "explore"].includes(r.status)).length,
      issues: rows.filter(r => r.issues.length).length
    };
    const chips = Object.entries(counts).map(([key, n]) => `
      <button type="button" class="glimpse-chip${key === this.#filter ? " is-active" : ""}" data-filter="${key}">
        ${esc(loc(`Overview.Filters.${key}`))} <span class="glimpse-count">${n}</span></button>`).join("");

    const accessLabel = level => {
      if ( level === null ) return "—";
      const key = Object.keys(LEVELS).find(k => LEVELS[k] === level);
      return esc(game.i18n.localize(`OWNERSHIP.${key}`));
    };
    const action = (name, icon) => `<button type="button" class="glimpse-ov-action" data-action="${name}"
      data-tooltip="${esc(loc(`Overview.Actions.${name}`))}" aria-label="${esc(loc(`Overview.Actions.${name}`))}">
      <i class="${icon}"></i></button>`;
    const body = rows.map(r => {
      const uuid = esc(r.doc.uuid);
      const issues = r.issues.map(key => `<li class="glimpse-ov-issue" data-issue="${key}">
        ${esc(loc(`Overview.Issues.${key}`))}</li>`).join("");
      return `
        <tr data-uuid="${uuid}" data-status="${r.status}" data-issues="${r.issues.length}"
            data-name="${esc(r.name.toLowerCase())}">
          <td class="glimpse-ov-check"><input type="checkbox" ${this.#selected.has(r.doc.uuid) ? "checked" : ""}
            aria-label="${esc(r.name)}"></td>
          <td class="glimpse-ov-name">
            <i class="${r.kind === "region" ? "fa-solid fa-draw-polygon" : "fa-solid fa-location-dot"}"
               data-tooltip="${esc(loc(`Overview.Kinds.${r.kind}`))}"></i>
            <span><strong>${esc(r.name)}</strong>${r.journal && (r.journal !== r.name)
              ? `<small>${esc(r.journal)}</small>` : ""}</span>
          </td>
          <td><span class="glimpse-ov-status" data-status="${r.status}">${esc(loc(`Overview.Status.${r.status}`))}</span></td>
          <td>${accessLabel(r.access)}</td>
          <td class="glimpse-ov-num">${r.images}</td>
          <td class="glimpse-ov-num">${r.text ? `<i class="fa-solid fa-check"></i>` : "—"}</td>
          <td><ul class="glimpse-ov-issues">${issues}</ul></td>
          <td class="glimpse-ov-actions">
            ${action("Pan", "fa-solid fa-crosshairs")}${action("Edit", "fa-solid fa-pen-to-square")}
            ${action("Gallery", "fa-solid fa-images")}${action("Reveal", "fa-solid fa-eye")}
          </td>
        </tr>`;
    }).join("");

    const head = ["Place", "Discovery", "Players", "Images", "Text", "Issues", ""]
      .map(key => `<th>${key ? esc(loc(`Overview.Columns.${key}`)) : ""}</th>`).join("");
    return `
      <div class="glimpse-picker-bar">
        <input type="search" class="glimpse-picker-search" placeholder="${esc(loc("Overview.Search"))}"
               value="${esc(this.#query)}" aria-label="${esc(loc("Overview.Search"))}">
      </div>
      <nav class="glimpse-picker-chips">${chips}</nav>
      <div class="glimpse-ov-scroll">
        <table class="glimpse-ov-table">
          <thead><tr><th class="glimpse-ov-check"><input type="checkbox" class="glimpse-ov-all"
            aria-label="${esc(loc("Overview.SelectAll"))}"></th>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>
        <p class="glimpse-overview-empty" hidden>${esc(loc(rows.length ? "Overview.NoMatch" : "Overview.Empty"))}</p>
      </div>
      <footer class="glimpse-ov-footer">
        <span class="glimpse-ov-selected"></span>
        <button type="button" data-bulk="discover"><i class="fa-solid fa-flag"></i> ${esc(loc("Overview.MarkDiscovered"))}</button>
        <button type="button" data-bulk="undiscover"><i class="fa-regular fa-flag"></i> ${esc(loc("Overview.MarkUndiscovered"))}</button>
        <span class="glimpse-ov-spacer"></span>
        <button type="button" data-bulk="export"><i class="fa-solid fa-file-export"></i> ${esc(loc("Overview.Export"))}</button>
        <button type="button" data-bulk="import"><i class="fa-solid fa-file-import"></i> ${esc(loc("Overview.Import"))}</button>
      </footer>`;
  }

  /** @override */
  _replaceHTML(html, content) {
    content.innerHTML = html;
    this.#activate(content);
  }

  /* -------------------------------------------- */

  /**
   * Wire up the search box, filters, rows and buttons.
   * @param {HTMLElement} content
   */
  #activate(content) {
    const search = content.querySelector(".glimpse-picker-search");
    search?.addEventListener("input", () => {
      this.#query = search.value;
      this.#applyFilter(content);
    });
    for ( const chip of content.querySelectorAll(".glimpse-chip") ) {
      chip.addEventListener("click", () => {
        this.#filter = chip.dataset.filter;
        content.querySelectorAll(".glimpse-chip").forEach(c => c.classList.toggle("is-active", c === chip));
        this.#applyFilter(content);
      });
    }
    for ( const box of content.querySelectorAll("tbody input[type=checkbox]") ) {
      box.addEventListener("change", () => {
        const uuid = box.closest("tr").dataset.uuid;
        if ( box.checked ) this.#selected.add(uuid);
        else this.#selected.delete(uuid);
        this.#updateSelection(content);
      });
    }
    content.querySelector(".glimpse-ov-all")?.addEventListener("change", event => {
      for ( const row of this.#visibleRows(content) ) {
        row.querySelector("input[type=checkbox]").checked = event.target.checked;
        if ( event.target.checked ) this.#selected.add(row.dataset.uuid);
        else this.#selected.delete(row.dataset.uuid);
      }
      this.#updateSelection(content);
    });
    for ( const button of content.querySelectorAll(".glimpse-ov-action") ) {
      button.addEventListener("click", () => this.#onAction(button.dataset.action, button.closest("tr").dataset.uuid));
    }
    for ( const button of content.querySelectorAll("[data-bulk]") ) {
      button.addEventListener("click", () => this.#onBulk(button.dataset.bulk));
    }
    this.#applyFilter(content);
  }

  /**
   * @param {HTMLElement} content
   * @returns {HTMLTableRowElement[]}
   */
  #visibleRows(content) {
    return Array.from(content.querySelectorAll("tbody tr")).filter(row => !row.hidden);
  }

  /**
   * Show only the rows that match the filter and search.
   * @param {HTMLElement} content
   */
  #applyFilter(content) {
    const query = this.#query.trim().toLowerCase();
    let shown = 0;
    for ( const row of content.querySelectorAll("tbody tr") ) {
      const filter = {all: true, rumoured: ["rumour", "explore"].includes(row.dataset.status),
        issues: row.dataset.issues !== "0"}[this.#filter];
      row.hidden = !(filter && (!query || row.dataset.name.includes(query)));
      if ( !row.hidden ) shown++;
    }
    const empty = content.querySelector(".glimpse-overview-empty");
    if ( empty ) empty.hidden = shown > 0;
    this.#updateSelection(content);
  }

  /**
   * Show how many places are selected and enable the bulk buttons that apply.
   * @param {HTMLElement} content
   */
  #updateSelection(content) {
    const n = this.#selected.size;
    const label = content.querySelector(".glimpse-ov-selected");
    if ( label ) label.textContent = n ? loc("Overview.Selected", {n}) : "";
    for ( const button of content.querySelectorAll("[data-bulk=discover], [data-bulk=undiscover]") ) {
      button.disabled = !n;
    }
    const all = content.querySelector(".glimpse-ov-all");
    const visible = this.#visibleRows(content);
    if ( all ) all.checked = !!visible.length && visible.every(row => this.#selected.has(row.dataset.uuid));
  }

  /* -------------------------------------------- */

  /**
   * Act on one place.
   * @param {string} action
   * @param {string} uuid
   */
  #onAction(action, uuid) {
    const doc = this.#rows.get(uuid)?.doc;
    if ( !doc ) return;
    switch ( action ) {
      case "Pan": {
        const center = doc.documentName === "Region" ? doc.object?.center : {x: doc.x, y: doc.y};
        if ( center ) canvas.animatePan({x: center.x, y: center.y, duration: 300});
        return;
      }
      case "Edit": return doc.sheet.render({force: true});
      case "Gallery": return openGallery(doc);
      case "Reveal": return revealToPlayers(doc);
    }
  }

  /**
   * Act on the selected places, or on the whole scene.
   * @param {string} action
   */
  async #onBulk(action) {
    switch ( action ) {
      case "discover": return this.#setDiscovered(true);
      case "undiscover": return this.#setDiscovered(false);
      case "export": return this.#export();
      case "import": return this.#pickImport();
    }
  }

  /**
   * Mark the selected rumoured places discovered, or undiscovered again. Discovering one shares its journal, as
   * the setting says.
   * @param {boolean} visited
   */
  async #setDiscovered(visited) {
    const scene = canvas.scene;
    const updates = {Note: [], Region: []};
    let rumoured = 0;
    for ( const uuid of this.#selected ) {
      const doc = this.#rows.get(uuid)?.doc;
      const flags = flagsOf(doc);
      if ( !doc || ((flags.discovery ?? "known") === "known") ) continue;
      rumoured++;
      if ( !!flags.visited === visited ) continue;
      updates[doc.documentName].push({_id: doc.id, [`flags.${MODULE_ID}.visited`]: visited});
    }
    const count = updates.Note.length + updates.Region.length;
    if ( !count ) {
      // Say why nothing changed: no rumoured places selected, or they were all marked that way already.
      const reason = !rumoured ? "NothingToMark" : (visited ? "AlreadyDiscovered" : "AlreadyUndiscovered");
      ui.notifications.info(loc(`Overview.${reason}`));
      return;
    }
    for ( const [type, changes] of Object.entries(updates) ) {
      if ( changes.length ) await scene.updateEmbeddedDocuments(type, changes);
    }
    const key = visited ? "Discovered" : "Undiscovered";
    ui.notifications.info(loc(`Overview.${key}${count === 1 ? "One" : ""}`, {n: count}));
  }

  /**
   * Download the scene's notes as a manifest.
   */
  #export() {
    const scene = canvas.scene;
    const data = exportLocations(scene);
    const name = `glimpse-${scene.name.slugify({strict: true}) || scene.id}.json`;
    foundry.utils.saveDataToFile(JSON.stringify(data, null, 2), "application/json", name);
  }

  /**
   * Ask for a manifest file to import.
   */
  #pickImport() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if ( file ) this.#import(file);
    }, {once: true});
    input.click();
  }

  /**
   * Show what a manifest would change, and import it once the GM agrees.
   * @param {File} file
   */
  async #import(file) {
    const esc = foundry.utils.escapeHTML;
    let locations;
    try {
      locations = manifestLocations(JSON.parse(await foundry.utils.readTextFromFile(file)));
    } catch(err) {
      locations = null;
    }
    if ( !locations?.length ) {
      ui.notifications.error(loc("Overview.ImportInvalid"));
      return;
    }

    const plan = await planLocations(locations);
    const action = (what, value) => (value ? esc(loc(`Overview.Plan.${what}.${value}`)) : "—");
    const rows = plan.map(row => {
      const notes = [];
      if ( row.error ) notes.push(esc(loc("Overview.Plan.Invalid", {error: row.error})));
      if ( row.handMadePages ) notes.push(esc(loc("Overview.Plan.HandMade", {n: row.handMadePages})));
      if ( row.missingMedia.length ) notes.push(esc(loc("Overview.Plan.Missing", {files: row.missingMedia.join(", ")})));
      return `<tr${row.error ? ` class="is-invalid"` : ""}><td>${esc(row.name || row.id || "?")}</td>
        <td>${action("Journal", row.journal)}</td><td>${action("Note", row.note)}</td><td>${notes.join("<br>")}</td></tr>`;
    }).join("");
    const content = `
      <p>${esc(loc("Overview.Plan.Intro", {n: locations.length, scene: canvas.scene.name}))}</p>
      <div class="glimpse-ov-plan"><table class="glimpse-ov-table">
        <thead><tr><th>${esc(loc("Overview.Columns.Place"))}</th><th>${esc(loc("Overview.Plan.JournalColumn"))}</th>
          <th>${esc(loc("Overview.Plan.NoteColumn"))}</th><th>${esc(loc("Overview.Columns.Issues"))}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: {title: loc("Overview.Import"), icon: "fa-solid fa-file-import"},
      classes: ["glimpse-overview-plan"],
      content,
      yes: {label: loc("Overview.Import"), icon: "fa-solid fa-file-import"},
      position: {width: 640}
    });
    if ( !confirmed ) return;

    const results = await applyLocations(locations);
    const failed = results.filter(r => !r.ok);
    for ( const r of failed ) console.warn(`Glimpse | Could not import "${r.id}": ${r.error}`);
    const done = results.length - failed.length;
    if ( failed.length ) ui.notifications.warn(loc("Overview.ImportPartial", {failed: failed.length, total: results.length}));
    else ui.notifications.info(loc(done === 1 ? "Overview.ImportedOne" : "Overview.Imported", {n: done}));
    this.render();
  }
}
