import {MODULE_ID, CARD_WIDTHS, EXCERPT_LENGTHS, api, loc, setting} from "./constants.mjs";
import {restyleAllNotes} from "./note-icons.mjs";
import {onRevealChange} from "./lightbox.mjs";

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
  register("style", new StringField({
    initial: "dusk", required: true, blank: false, choices: choices("style", ["dusk", "parchment", "auto"])
  }));
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
 * Turn previews on or off for this client and tell the user.
 * @param {boolean} value
 */
export async function toggleEnabled(value) {
  if ( value === setting("enabled") ) return;
  await game.settings.set(MODULE_ID, "enabled", value);
  ui.notifications.info(loc(value ? "Enabled" : "Disabled"));
}
