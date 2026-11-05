import {MODULE_ID, CARD_STYLES, CARD_WIDTHS, EXCERPT_LENGTHS, IMAGE_EFFECT_STYLES, SCANLINE_STYLES, api, loc,
  setting} from "./constants.mjs";
import {restyleAllNotes} from "./note-icons.mjs";
import {onRevealChange} from "./lightbox.mjs";
import {chosenStyle, resolveStyle} from "./card.mjs";

const {BooleanField, NumberField, StringField} = foundry.data.fields;

/**
 * Build a localized choices record for a StringField.
 * @param {string} key        The settings key, used to find localization strings
 * @param {string[]} values   The allowed values
 * @returns {Record<string, string>}
 */
function choices(key, values) {
  return Object.fromEntries(values.map(v => [v, `GLIMPSE.Settings.${key}.Choices.${v}`]));
}

/**
 * Register a setting with localized name and hint.
 * @param {string} key
 * @param {DataField} type
 * @param {object} [options]
 * @param {"client"|"world"} [options.scope="client"]
 * @param {Function} [options.onChange]
 */
function register(key, type, {scope="client", onChange}={}) {
  game.settings.register(MODULE_ID, key, {
    name: `GLIMPSE.Settings.${key}.Name`,
    hint: `GLIMPSE.Settings.${key}.Hint`,
    scope,
    config: true,
    type,
    onChange: onChange ?? (() => api()?.refresh())
  });
}

const refreshAll = () => api()?.refresh({clearCache: true});

export function registerSettings() {

  // Previews
  register("enabled", new BooleanField({initial: true}), {
    onChange: value => {
      if ( !value ) api()?.hide({immediate: true});
      ui.controls?.render({reset: true});
    }
  });
  // The GM picks the table's card style, and whether players may pick their own instead (see chosenStyle).
  const styles = [...CARD_STYLES, "system", "auto"];
  register("style", new StringField({
    initial: "dusk", required: true, blank: false, choices: choices("style", styles)
  }), {scope: "world"});
  register("playerStyles", new BooleanField({initial: false}), {scope: "world"});
  register("playerStyle", new StringField({
    initial: "table", required: true, blank: false,
    choices: {table: "GLIMPSE.Settings.playerStyle.Choices.table", ...choices("style", styles)}
  }));
  // Right under the style, and shown only for the styles that have them (see onRenderSettingsConfig).
  register("imageEffects", new BooleanField({initial: true}));
  register("scanlines", new BooleanField({initial: true}));
  register("size", new StringField({
    initial: "medium", required: true, blank: false, choices: choices("size", Object.keys(CARD_WIDTHS))
  }));
  register("excerpt", new StringField({
    initial: "medium", required: true, blank: false, choices: choices("excerpt", Object.keys(EXCERPT_LENGTHS))
  }), {onChange: refreshAll});
  register("textScale", new NumberField({
    initial: 100, min: 80, max: 140, step: 5, integer: true, nullable: false
  }));
  register("delay", new NumberField({
    initial: 200, min: 0, max: 1000, step: 50, integer: true, nullable: false
  }));
  register("regionMode", new StringField({
    initial: "hover", required: true, blank: false, choices: choices("regionMode", ["hover", "key", "off"])
  }), {onChange: () => api()?.regions?.reset()});

  // Atmosphere
  register("slideshow", new BooleanField({initial: true}));
  register("motion", new BooleanField({initial: false}));
  register("soundVolume", new NumberField({
    initial: 40, min: 0, max: 100, step: 5, integer: true, nullable: false
  }), {onChange: () => api()?.sound?.stop()});
  register("travel", new BooleanField({initial: true}));
  register("hideLabel", new BooleanField({initial: true}));
  register("secrets", new BooleanField({initial: false}), {onChange: refreshAll});

  // World: how note icons look on the map. Defaults match Foundry, so nothing changes until the GM opts in.
  const restyle = () => restyleAllNotes();
  register("iconBackground", new StringField({
    initial: "square", required: true, blank: false,
    choices: choices("iconBackground", ["square", "circle", "outline", "none"])
  }), {scope: "world", onChange: restyle});
  register("iconFrame", new StringField({
    initial: "always", required: true, blank: false, choices: choices("iconFrame", ["always", "hover", "never"])
  }), {scope: "world", onChange: restyle});
  register("iconHoverGrow", new BooleanField({initial: false}), {scope: "world", onChange: restyle});

  // World
  register("doubleClick", new StringField({
    initial: "gallery", required: true, blank: false, choices: choices("doubleClick", ["gallery", "journal"])
  }), {scope: "world", onChange: () => {}});
  register("shareOnDiscovery", new StringField({
    initial: "observer", required: true, blank: false,
    choices: choices("shareOnDiscovery", ["off", "limited", "observer"])
  }), {scope: "world", onChange: () => {}});
  register("travelPerDay", new NumberField({
    initial: 24, min: 0, step: 0.5, nullable: false
  }), {scope: "world"});
  register("nightStart", new NumberField({
    initial: 20, min: 0, max: 23, step: 1, integer: true, nullable: false
  }), {scope: "world", onChange: refreshAll});
  register("nightEnd", new NumberField({
    initial: 6, min: 0, max: 23, step: 1, integer: true, nullable: false
  }), {scope: "world", onChange: refreshAll});

  // The location a GM last showed to the table. Only GMs may write world settings, and Foundry reports who did, so
  // players can trust what arrives here.
  game.settings.register(MODULE_ID, "reveal", {
    scope: "world",
    config: false,
    type: new foundry.data.fields.ObjectField(),
    onChange: (value, options, userId) => onRevealChange(value, userId)
  });

  registerKeybindings();
}

function registerKeybindings() {
  game.keybindings.register(MODULE_ID, "toggle", {
    name: "GLIMPSE.Keybindings.toggle.Name",
    editable: [],
    onDown: () => {
      toggleEnabled(!setting("enabled"));
      return true;
    }
  });
  game.keybindings.register(MODULE_ID, "reveal", {
    name: "GLIMPSE.Keybindings.reveal.Name",
    hint: "GLIMPSE.Keybindings.reveal.Hint",
    editable: [],
    restricted: true,
    onDown: () => {
      const note = api()?.card?.note;
      if ( !note ) return false;
      api().reveal(note.document);
      return true;
    }
  });
  game.keybindings.register(MODULE_ID, "peek", {
    name: "GLIMPSE.Keybindings.peek.Name",
    hint: "GLIMPSE.Keybindings.peek.Hint",
    editable: [{key: "KeyG"}],
    onDown: () => {
      if ( setting("regionMode") !== "key" ) return false;
      api()?.regions?.setPeeking(true);
      return true;
    },
    onUp: () => {
      api()?.regions?.setPeeking(false);
    }
  });
}

/**
 * In the settings window, show a player's own style picker only while the GM lets players choose, and show Image
 * effects and Scanlines only while the style in use has them, following the pickers as they change.
 * @param {SettingsConfig} app
 * @param {HTMLElement} element
 */
export function onRenderSettingsConfig(app, element) {
  const field = key => element.querySelector(`[name="${MODULE_ID}.${key}"]`);
  const group = key => field(key)?.closest(".form-group");
  // Only those who can change world settings get the table's picker and the toggle; they don't need their own.
  const tableSelect = field("style");
  const allowToggle = field("playerStyles");
  const ownSelect = field("playerStyle");
  if ( !tableSelect && !ownSelect ) return;
  const dependents = {imageEffects: IMAGE_EFFECT_STYLES, scanlines: SCANLINE_STYLES};
  const update = () => {
    const allowed = allowToggle?.checked ?? setting("playerStyles");
    const own = group("playerStyle");
    if ( own ) own.style.display = (allowed && !tableSelect) ? "" : "none";
    const style = resolveStyle(chosenStyle({
      table: tableSelect?.value, allowed, own: tableSelect ? "table" : ownSelect?.value
    }));
    for ( const [key, styles] of Object.entries(dependents) ) {
      const dependent = group(key);
      if ( dependent ) dependent.style.display = styles.includes(style) ? "" : "none";
    }
  };
  for ( const input of [tableSelect, allowToggle, ownSelect] ) input?.addEventListener("change", update);
  update();
}

/**
 * The card style used to be each player's own choice, stored in their browser under the key the table's style now
 * uses. Move it once: a GM's choice becomes the table's style, a player's becomes their own style, which shows only
 * if the GM lets players choose.
 */
export async function migrateStyleSetting() {
  const key = `${MODULE_ID}.style`;
  const client = game.settings.storage.get("client");
  const stored = client.getItem(key);
  if ( stored === null ) return;
  client.removeItem(key);
  let value;
  try {
    value = JSON.parse(stored);
  } catch {
    value = stored;
  }
  if ( !game.settings.settings.get(key).type.choices[value] ) return;
  if ( game.user.can("SETTINGS_MODIFY") ) {
    if ( !game.settings.storage.get("world").getSetting(key) ) await game.settings.set(MODULE_ID, "style", value);
  }
  // "dusk" was the old default, which players saved without choosing it whenever they saved their settings.
  else if ( (value !== "dusk") && !(`${MODULE_ID}.playerStyle` in client) ) {
    await game.settings.set(MODULE_ID, "playerStyle", value);
  }
}

/**
 * Turn previews on or off for this client and tell the user.
 * @param {boolean} value
 */
export async function toggleEnabled(value) {
  if ( value === setting("enabled") ) return;
  await game.settings.set(MODULE_ID, "enabled", value);
  ui.notifications.info(loc(value ? "Enabled" : "Disabled"));
}
