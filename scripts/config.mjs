import {MODULE_ID, CARD_WIDTHS, DISCOVERY_MODES, NOTE_MODES, SEALS, api, flagsOf, loc, setting} from "./constants.mjs";
import {IconPicker, cssUrl, glimpseIconId, iconLabel} from "./icon-picker.mjs";
import {regionSource} from "./content.mjs";

const {createCheckboxInput, createFormGroup, createNumberInput, createSelectInput, createTextareaInput,
  createTextInput} = foundry.applications.fields;

const name = key => `flags.${MODULE_ID}.${key}`;

/* -------------------------------------------- */
/*  Shared Field Builders                       */
/* -------------------------------------------- */

/**
 * @param {string} key          Localization key under GLIMPSE.Config
 * @param {HTMLElement} input
 * @param {object} [options]
 * @returns {HTMLDivElement}
 */
function group(key, input, {hint=true, classes=[], rootId}={}) {
  return createFormGroup({
    label: loc(`Config.${key}`),
    hint: hint ? loc(`Config.${key}Hint`) : undefined,
    input,
    classes,
    rootId
  });
}

/**
 * @param {string} legendKey
 * @param {string} icon
 * @returns {HTMLFieldSetElement}
 */
function fieldset(legendKey, icon) {
  const fs = document.createElement("fieldset");
  fs.className = "glimpse-config";
  const legend = document.createElement("legend");
  legend.innerHTML = `<i class="${icon}"></i> ${loc(`Config.${legendKey}`)}`;
  fs.append(legend);
  return fs;
}

/**
 * A file picker paired with a focal-point picker for the chosen image.
 * @param {object} flags
 * @param {string} rootId
 * @returns {HTMLElement[]}
 */
function imageGroups(flags, rootId) {
  const picker = foundry.applications.elements.HTMLFilePickerElement.create({
    name: name("image"), type: "imagevideo", value: flags.image || ""
  });
  const focal = createFocalPicker({src: flags.image, x: flags.focusX, y: flags.focusY, prefix: ""});
  picker.addEventListener("change", () => focal.setSource(picker.value));
  const imageGroup = group("Image", picker, {rootId});
  const focalGroup = group("Focus", focal, {rootId});
  focal.bindGroup(focalGroup);

  const night = foundry.applications.elements.HTMLFilePickerElement.create({
    name: name("nightImage"), type: "imagevideo", value: flags.nightImage || ""
  });
  return [imageGroup, focalGroup, group("NightImage", night, {rootId})];
}

/**
 * The "how it looks" fields shared by notes and regions.
 * @param {object} flags
 * @param {string} rootId
 * @param {object} [options]
 * @param {boolean} [options.withSize=true]
 * @returns {HTMLElement[]}
 */
function presentationGroups(flags, rootId, {withSize=true}={}) {
  const groups = [];
  groups.push(group("Mode", createSelectInput({
    name: name("mode"),
    value: flags.mode || "auto",
    options: NOTE_MODES.map(value => ({value, label: loc(`Config.Modes.${value}`)}))
  }), {rootId}));
  if ( withSize ) {
    groups.push(group("Size", createSelectInput({
      name: name("size"),
      value: flags.size || "",
      options: [
        {value: "", label: loc("Config.SizeDefault")},
        ...Object.keys(CARD_WIDTHS).map(value => ({value, label: loc(`Settings.size.Choices.${value}`)}))
      ]
    }), {rootId}));
  }
  groups.push(...imageGroups(flags, rootId));
  groups.push(group("Subtitle", createTextInput({
    name: name("subtitle"), value: flags.subtitle || "", placeholder: loc("Config.SubtitlePlaceholder")
  }), {rootId}));
  groups.push(group("Facts", createTextareaInput({
    name: name("facts"), value: flags.facts || "", rows: 3, placeholder: loc("Config.FactsPlaceholder")
  }), {rootId, classes: ["stacked"]}));
  groups.push(group("Sound", foundry.applications.elements.HTMLFilePickerElement.create({
    name: name("sound"), type: "audio", value: flags.sound || ""
  }), {rootId}));
  groups.push(group("Seal", createSelectInput({
    name: name("seal"),
    value: flags.seal || "",
    options: [
      {value: "", label: loc("Config.SealAuto")},
      {value: "none", label: loc("Config.SealNone")},
      ...Object.entries(SEALS).map(([value, glyph]) => ({value, label: `${glyph}  ${loc(`Config.Seals.${value}`)}`}))
    ]
  }), {rootId}));
  return groups;
}

/**
 * The discovery fields: known, rumoured or revealed by exploration.
 * @param {object} flags
 * @param {string} rootId
 * @returns {HTMLFieldSetElement}
 */
function discoveryFieldset(flags, rootId) {
  const fs = fieldset("DiscoveryLegend", "fa-solid fa-compass");
  const discovery = flags.discovery || "known";
  const select = createSelectInput({
    name: name("discovery"),
    value: discovery,
    options: DISCOVERY_MODES.map(value => ({value, label: loc(`Config.DiscoveryModes.${value}`)}))
  });
  const rumour = group("Rumour", createTextareaInput({
    name: name("rumour"), value: flags.rumour || "", rows: 2, placeholder: loc("RumourDefault")
  }), {rootId, classes: ["stacked"]});
  const visited = group("Visited", createCheckboxInput({name: name("visited"), value: !!flags.visited}), {rootId});
  const sync = () => {
    const known = select.value === "known";
    rumour.hidden = known;
    visited.hidden = known;
  };
  select.addEventListener("change", sync);
  fs.append(group("Discovery", select, {rootId}), rumour, visited);
  sync();
  return fs;
}

/**
 * A button that shows the card for the form's current, unsaved values while hovered.
 * @param {DocumentSheetV2} app
 * @returns {HTMLElement}
 */
function previewButton(app) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "glimpse-preview-button";
  button.innerHTML = `<i class="fa-solid fa-mountain-sun"></i> ${loc("Config.Preview")}`;
  const show = () => {
    const data = foundry.utils.expandObject(new foundry.applications.ux.FormDataExtended(app.form).object);
    const changes = {flags: {[MODULE_ID]: data.flags?.[MODULE_ID] ?? {}}};
    for ( const key of ["entryId", "pageId", "text"] ) if ( key in data ) changes[key] = data[key];
    const preview = app.document.clone(changes, {keepId: true});
    api()?.card?.showPreview(preview, app.element);
  };
  button.addEventListener("pointerenter", show);
  button.addEventListener("focus", show);
  const hide = () => api()?.card?.hide();
  button.addEventListener("pointerleave", hide);
  button.addEventListener("blur", hide);
  return button;
}

/* -------------------------------------------- */
/*  Focal Point Picker                          */
/* -------------------------------------------- */

/**
 * A thumbnail of an image which records where you click as the image's focal point.
 * @param {object} options
 * @param {string} [options.src]
 * @param {number} [options.x=50]
 * @param {number} [options.y=50]
 * @returns {HTMLElement & {setSource: Function, bindGroup: Function}}
 */
export function createFocalPicker({src, x, y}) {
  x = Number(x ?? 50);
  y = Number(y ?? 50);
  const el = document.createElement("div");
  el.className = "glimpse-focal";
  el.innerHTML = `
    <div class="glimpse-focal-frame" data-tooltip="${loc("Config.FocusTooltip")}">
      <img alt="">
      <span class="glimpse-focal-dot"></span>
    </div>
    <input type="hidden" name="${name("focusX")}" data-dtype="Number">
    <input type="hidden" name="${name("focusY")}" data-dtype="Number">`;
  const img = el.querySelector("img");
  const dot = el.querySelector(".glimpse-focal-dot");
  const [inputX, inputY] = el.querySelectorAll("input");
  let groupEl = null;

  const set = (nx, ny) => {
    x = Math.round(Math.clamp(nx, 0, 100));
    y = Math.round(Math.clamp(ny, 0, 100));
    inputX.value = String(x);
    inputY.value = String(y);
    dot.style.left = `${x}%`;
    dot.style.top = `${y}%`;
  };
  set(x, y);

  el.querySelector(".glimpse-focal-frame").addEventListener("click", event => {
    const r = img.getBoundingClientRect();
    if ( !r.width ) return;
    set(((event.clientX - r.left) / r.width) * 100, ((event.clientY - r.top) / r.height) * 100);
    inputX.dispatchEvent(new Event("change", {bubbles: true}));
  });

  el.setSource = value => {
    const isImage = !!value && !foundry.helpers.media.VideoHelper.hasVideoExtension(value);
    if ( isImage ) img.src = value;
    else img.removeAttribute("src");
    if ( groupEl ) groupEl.hidden = !isImage;
  };
  el.bindGroup = g => {
    groupEl = g;
    el.setSource(src);
  };
  el.setSource(src);
  return el;
}

/* -------------------------------------------- */
/*  Note Config                                 */
/* -------------------------------------------- */

/**
 * Add Glimpse fieldsets to the Note configuration sheet.
 * @param {NoteConfig} app
 * @param {HTMLElement} element
 */
export function onRenderNoteConfig(app, element) {
  const body = element.querySelector(".form-body");
  if ( !body || body.querySelector(".glimpse-config") ) return;
  enhanceIconField(app, element);
  const flags = flagsOf({flags: app.document._source.flags});
  const rootId = app.id;

  const presentation = fieldset("Legend", "fa-solid fa-mountain-sun");
  presentation.append(...presentationGroups(flags, rootId));
  const footer = document.createElement("div");
  footer.className = "glimpse-config-footer";
  footer.append(previewButton(app));
  presentation.append(footer);

  // Place them directly after the Content fieldset, which holds the journal entry and page.
  const content = body.querySelector("fieldset");
  const discovery = discoveryFieldset(flags, rootId);
  if ( content ) content.after(presentation, discovery);
  else body.append(presentation, discovery);
}

/* -------------------------------------------- */
/*  Region Config                               */
/* -------------------------------------------- */

/**
 * Add a Glimpse tab to the Region configuration sheet.
 * @param {RegionConfig} app
 * @param {HTMLElement} element
 */
export function onRenderRegionConfig(app, element) {
  const nav = element.querySelector("nav.sheet-tabs");
  if ( !nav || element.querySelector(".tab[data-tab='glimpse']") ) return;
  const flags = flagsOf({flags: app.document._source.flags});
  const rootId = app.id;
  const active = app.tabGroups.sheet === "glimpse";

  // Navigation entry.
  const link = document.createElement("a");
  link.dataset.action = "tab";
  link.dataset.group = "sheet";
  link.dataset.tab = "glimpse";
  link.classList.toggle("active", active);
  link.innerHTML = `<i class="fa-solid fa-mountain-sun" inert></i> <span>${loc("Title")}</span>`;
  nav.append(link);

  // Tab contents. Core region tabs clip their overflow, so scroll an inner wrapper as they do.
  const section = document.createElement("section");
  section.className = "tab region-glimpse flexcol";
  section.classList.toggle("active", active);
  section.dataset.tab = "glimpse";
  section.dataset.group = "sheet";
  const body = document.createElement("div");
  body.className = "scrollable";
  section.append(body);

  const hint = document.createElement("p");
  hint.className = "hint glimpse-region-hint";
  hint.textContent = loc("Config.RegionIntro");
  body.append(hint);

  const general = fieldset("RegionLegend", "fa-solid fa-map");
  general.append(group("Enabled", createCheckboxInput({name: name("enabled"), value: !!flags.enabled}), {rootId}));
  const entries = game.journal.filter(e => e.visible)
    .map(e => ({value: e.id, label: e.name}))
    .sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));
  const entrySelect = createSelectInput({name: name("entryId"), value: flags.entryId || "", blank: "", options: entries});
  const pageSelect = createSelectInput({name: name("pageId"), value: flags.pageId || "", blank: "",
    options: pageOptions(flags.entryId)});
  entrySelect.addEventListener("change", () => {
    pageSelect.replaceChildren(...createSelectInput({blank: "", options: pageOptions(entrySelect.value)}).children);
  });
  general.append(
    group("Entry", entrySelect, {rootId}),
    group("Page", pageSelect, {rootId, hint: false}),
    group("RegionTitle", createTextInput({name: name("title"), value: flags.title || "",
      placeholder: regionSource(app.document).title}), {rootId})
  );

  const presentation = fieldset("Legend", "fa-solid fa-mountain-sun");
  presentation.append(...presentationGroups(flags, rootId, {withSize: false}));
  body.append(general, presentation, discoveryFieldset(flags, rootId));

  const last = element.querySelector(".tab[data-group='sheet'][data-tab='behaviors']")
    ?? Array.from(element.querySelectorAll(".tab[data-group='sheet']")).at(-1);
  if ( last ) last.after(section);

  // A full re-render resets the core tabs; keep the Glimpse tab open if it was.
  if ( active ) app.changeTab("glimpse", "sheet", {force: true, updatePosition: false});
}

/**
 * Pages of a journal entry as select options.
 * @param {string} entryId
 * @returns {{value: string, label: string}[]}
 */
function pageOptions(entryId) {
  const entry = game.journal.get(entryId);
  if ( !entry ) return [];
  return entry.pages.contents.sort((a, b) => a.sort - b.sort).map(p => ({value: p.id, label: p.name}));
}

/* -------------------------------------------- */
/*  Image Page Sheet                            */
/* -------------------------------------------- */

/**
 * Add a focal point and night variant to image pages in edit mode.
 * @param {JournalEntryPageImageSheet} app
 * @param {HTMLElement} element
 */
export function onRenderImagePageSheet(app, element) {
  const preview = element.querySelector("figure.image-preview");
  if ( !preview || element.querySelector(".glimpse-config") ) return;
  const flags = flagsOf({flags: app.document._source.flags});
  const rootId = app.id;
  const fs = fieldset("PageLegend", "fa-solid fa-mountain-sun");
  const focal = createFocalPicker({src: app.document.src, x: flags.focusX, y: flags.focusY});
  const focalGroup = group("Focus", focal, {rootId});
  focal.bindGroup(focalGroup);
  const night = foundry.applications.elements.HTMLFilePickerElement.create({
    name: name("night"), type: "image", value: flags.night || ""
  });
  fs.append(focalGroup, group("NightImage", night, {rootId}));

  // Keep the picker in step with the page's own image field.
  const src = element.querySelector("[name='src']");
  src?.addEventListener("change", () => focal.setSource(src.value));
  preview.closest("section")?.append(fs);
}

/* -------------------------------------------- */
/*  Scene Config                                */
/* -------------------------------------------- */

/**
 * Add a travel-per-day override to the Grid tab, beside the scene's units.
 * @param {SceneConfig} app
 * @param {HTMLElement} element
 */
export function onRenderSceneConfig(app, element) {
  const units = element.querySelector("[name='grid.units']")?.closest(".form-group");
  if ( !units || element.querySelector(`[name='${name("travelPerDay")}']`) ) return;
  const input = createNumberInput({
    name: name("travelPerDay"),
    value: flagsOf({flags: app.document._source.flags}).travelPerDay,
    min: 0,
    step: 0.5,
    placeholder: String(setting("travelPerDay"))
  });
  units.after(group("TravelPerDay", input, {rootId: app.id}));
}

/* -------------------------------------------- */
/*  Flag Defaults                               */
/* -------------------------------------------- */

/**
 * What an unset Glimpse flag means. Values equal to these are not stored, so saving a sheet does not stamp every
 * document with a full set of empty flags.
 */
const FLAG_DEFAULTS = {
  mode: "auto", size: "", image: "", focusX: 50, focusY: 50, nightImage: "", subtitle: "", facts: "", sound: "", seal: "",
  discovery: "known", rumour: "", visited: false, enabled: false, entryId: "", pageId: "", title: "", night: "",
  travelPerDay: null
};

/**
 * Is a submitted value the same as leaving the flag unset?
 * @param {string} key
 * @param {*} value
 * @returns {boolean}
 */
function isDefault(key, value) {
  const fallback = FLAG_DEFAULTS[key];
  if ( fallback === null ) return (value === null) || (value === undefined) || (value === "");
  if ( typeof fallback === "number" ) return (value !== "") && (value !== null) && (Number(value) === fallback);
  return value === fallback;
}

/**
 * Drop default-valued Glimpse flags from a new document. V14 sends the pending document rather than the hook's
 * data, so the change goes through its source.
 * @param {ClientDocument} doc
 */
export function pruneCreateFlags(doc) {
  const flags = doc._source.flags?.[MODULE_ID];
  if ( !flags || (typeof flags !== "object") ) return;
  const drop = {};
  for ( const [key, value] of Object.entries(flags) ) {
    if ( (key in FLAG_DEFAULTS) && isDefault(key, value) ) drop[key] = foundry.data.operators.ForcedDeletion.create();
  }
  if ( !foundry.utils.isEmpty(drop) ) doc.updateSource({flags: {[MODULE_ID]: drop}});
}

/**
 * Drop default-valued Glimpse flags from an update, deleting any the document already stores.
 * @param {ClientDocument} doc
 * @param {object} changes
 */
export function pruneUpdateFlags(doc, changes) {
  const stored = doc._source.flags?.[MODULE_ID] ?? {};
  const prune = (container, prop, key) => {
    if ( !(key in FLAG_DEFAULTS) || !isDefault(key, container[prop]) ) return;
    if ( key in stored ) container[prop] = foundry.data.operators.ForcedDeletion.create();
    else delete container[prop];
  };
  const flags = changes.flags?.[MODULE_ID];
  if ( flags && (typeof flags === "object") ) {
    for ( const key of Object.keys(flags) ) prune(flags, key, key);
  }
  // Document#setFlag submits a dotted path rather than a nested object.
  const prefix = `flags.${MODULE_ID}.`;
  for ( const path of Object.keys(changes) ) {
    if ( path.startsWith(prefix) ) prune(changes, path, path.slice(prefix.length));
  }
}

/* -------------------------------------------- */
/*  Note Icon Picker                            */
/* -------------------------------------------- */

/** Value of the dropdown entry that opens the picker. */
const BROWSE = "__glimpse_browse__";

/**
 * Add a "Glimpse icons" entry and a preview button to the note's Entry Icon dropdown. Choosing either opens a
 * visual picker; a Glimpse icon then shows by name in the dropdown instead of as a custom path.
 * @param {NoteConfig} app
 * @param {HTMLElement} element
 */
function enhanceIconField(app, element) {
  const form = app.form;
  const select = form?.elements["icon.selected"];
  const custom = form?.elements["icon.custom"];
  if ( !select || !custom || select.querySelector(`option[value="${BROWSE}"]`) ) return;
  const customGroup = custom.closest(".form-group");

  // The browse entry, right after "Custom".
  const browse = document.createElement("option");
  browse.value = BROWSE;
  browse.textContent = loc("Picker.Option");
  select.insertBefore(browse, select.options[1] ?? null);

  // Preview swatch that also opens the picker.
  const swatch = document.createElement("button");
  swatch.type = "button";
  swatch.className = "glimpse-icon-browse";
  swatch.dataset.tooltip = loc("Picker.Title");
  swatch.setAttribute("aria-label", loc("Picker.Title"));
  swatch.innerHTML = `<span class="glimpse-icon-swatch" data-style="${setting("iconBackground")}">`
    + `<span class="glimpse-icon-art"></span></span>`;
  select.after(swatch);
  swatch.addEventListener("click", () => open());

  let previous = select.value;
  select.addEventListener("change", event => {
    if ( select.value !== BROWSE ) {
      previous = select.value;
      updateSwatch();
      return;
    }
    // Keep core from treating the browse entry as an icon.
    event.stopPropagation();
    select.value = previous;
    open();
  });
  form.elements["texture.tint"]?.addEventListener?.("change", updateSwatch);
  custom.addEventListener("change", updateSwatch);

  // A Glimpse icon already in use shows by name rather than as a custom path.
  const current = app.document._source.texture.src;
  if ( glimpseIconId(current) ) choose(current, {notify: false});
  updateSwatch();

  /** The icon the form currently points at. */
  function currentSrc() {
    return select.value || custom.value || "";
  }

  /** The tint the form currently uses. */
  function currentTint() {
    return form.elements["texture.tint"]?.value || "#ffffff";
  }

  function updateSwatch() {
    const art = swatch.querySelector(".glimpse-icon-art");
    const src = currentSrc();
    art.style.setProperty("--icon", cssUrl(src));
    art.style.setProperty("--tint", currentTint());
  }

  function open() {
    foundry.applications.instances.get("glimpse-icon-picker")?.close();
    new IconPicker({current: currentSrc(), tint: currentTint(), onPick: src => choose(src)}).render({force: true});
  }

  /**
   * Select an icon in the form, adding it to the dropdown when it is not one of Foundry's.
   * @param {string} src
   * @param {object} [options]
   * @param {boolean} [options.notify=true]   Fire change events so Foundry updates the preview
   */
  function choose(src, {notify = true} = {}) {
    if ( !select.querySelector(`option[value="${CSS.escape(src)}"]`) ) {
      const id = glimpseIconId(src);
      const option = document.createElement("option");
      option.value = src;
      option.textContent = id ? `${loc("Title")} · ${iconLabel(id)}` : src.split("/").pop();
      option.dataset.glimpse = "";
      select.insertBefore(option, select.options[2] ?? null);
    }
    select.value = src;
    previous = src;
    customGroup.hidden = true;
    updateSwatch();
    if ( notify ) select.dispatchEvent(new Event("change", {bubbles: true}));
  }
}
