import {LIGHTBOX_TEMPLATE, MODULE_ID, SOCKET, TEMPLATE, api, flagsOf, setting} from "./constants.mjs";
import {registerSettings, toggleEnabled} from "./settings.mjs";
import {PAGE_READERS, clearCache, isNight, regionEnabled} from "./content.mjs";
import {onRenderImagePageSheet, onRenderNoteConfig, onRenderRegionConfig} from "./config.mjs";
import {NoteCard} from "./card.mjs";
import {RegionBanner, RegionTracker} from "./regions.mjs";
import {GlimpseLightbox, noteHasMedia, onSocketMessage, openGallery, revealToPlayers} from "./lightbox.mjs";
import GlimpseSound from "./sound.mjs";
import {styleNoteIcon} from "./note-icons.mjs";

Hooks.once("init", () => {
  registerSettings();
  foundry.applications.handlebars.loadTemplates([TEMPLATE, LIGHTBOX_TEMPLATE]);
});

Hooks.once("ready", () => {
  const card = new NoteCard();
  const banner = new RegionBanner();
  const lightbox = new GlimpseLightbox();
  const regions = new RegionTracker(banner);
  const sound = new GlimpseSound();
  game.modules.get(MODULE_ID).api = {
    card, banner, lightbox, regions, sound,
    show: note => card.showNote(note),
    hide: options => {
      card.hide(options);
      banner.hide(options);
    },
    refresh: async ({clearCache: clear=false}={}) => {
      if ( clear ) clearCache();
      await Promise.all([card.refresh(), banner.refresh()]);
    },
    reveal: doc => revealToPlayers(doc),
    openGallery: doc => openGallery(doc),
    toggle: value => toggleEnabled(value ?? !setting("enabled")),
    /**
     * Teach Glimpse to read a system's own journal page type.
     * @param {string} type                                         The page type, e.g. "mysystem.location"
     * @param {(page: JournalEntryPage) => GlimpsePageContent} reader  Returns {html, image, caption}
     */
    registerPageReader: (type, reader) => {
      PAGE_READERS[type] = reader;
      clearCache();
    }
  };
  Hooks.callAll("glimpseReady", game.modules.get(MODULE_ID).api);
  game.socket.on(SOCKET, onSocketMessage);
  if ( canvas.ready ) regions.attach();
  else Hooks.once("canvasReady", () => regions.attach());
});

/* -------------------------------------------- */
/*  Note Icons                                  */
/* -------------------------------------------- */

Hooks.on("refreshNote", note => styleNoteIcon(note));

/* -------------------------------------------- */
/*  Hover                                       */
/* -------------------------------------------- */

Hooks.on("hoverNote", (note, hovered) => {
  const glimpse = api();
  if ( !glimpse ) return;
  if ( hovered ) {
    glimpse.regions.reset();
    glimpse.card.hoverIn(note);
  }
  else {
    glimpse.card.hoverOut(note);
    glimpse.regions.schedule();
  }
});

/* -------------------------------------------- */
/*  Canvas Lifecycle                            */
/* -------------------------------------------- */

Hooks.once("canvasReady", () => {
  // Any click on the canvas dismisses the card, so it never lingers over a drag or a double-click.
  canvas.app.view.addEventListener("pointerdown", () => api()?.hide({immediate: true}), {passive: true});
});
Hooks.on("canvasReady", () => api()?.hide({immediate: true}));
Hooks.on("canvasTearDown", () => {
  api()?.hide({immediate: true});
  api()?.regions.reset();
});
Hooks.on("canvasPan", () => {
  api()?.card.schedulePosition();
  api()?.regions.schedule();
});

/* -------------------------------------------- */
/*  Double-Click Gallery                        */
/* -------------------------------------------- */

Hooks.on("activateNote", note => {
  if ( setting("doubleClick") !== "gallery" ) return;
  if ( !noteHasMedia(note.document) ) return;
  openGallery(note.document);
  return false;
});

/* -------------------------------------------- */
/*  Data Changes                                */
/* -------------------------------------------- */

/**
 * Something a card may be showing has changed: forget cached content and redraw what is open.
 */
function onContentChanged() {
  api()?.refresh({clearCache: true});
}

for ( const hook of ["updateNote", "updateRegion", "updateJournalEntry", "deleteJournalEntry",
  "createJournalEntryPage", "updateJournalEntryPage", "deleteJournalEntryPage"] ) {
  Hooks.on(hook, onContentChanged);
}
for ( const hook of ["deleteNote", "deleteRegion"] ) {
  Hooks.on(hook, doc => {
    clearCache();
    const glimpse = api();
    if ( glimpse?.card.target?.key === doc.uuid ) glimpse.card.hide({immediate: true});
    if ( glimpse?.banner.target?.key === doc.uuid ) glimpse.banner.hide({immediate: true});
  });
}

// Swap day and night images when the world clock crosses the configured hours.
let wasNight = null;
Hooks.on("updateWorldTime", () => {
  const night = isNight();
  if ( night === wasNight ) return;
  wasNight = night;
  onContentChanged();
});

/* -------------------------------------------- */
/*  Sheets                                      */
/* -------------------------------------------- */

Hooks.on("renderNoteConfig", onRenderNoteConfig);
Hooks.on("renderRegionConfig", onRenderRegionConfig);
Hooks.on("renderJournalEntryPageImageSheet", onRenderImagePageSheet);
Hooks.on("closeNoteConfig", () => {
  const card = api()?.card;
  if ( card?.target?.key.startsWith("preview:") ) card.hide({immediate: true});
});

/* -------------------------------------------- */
/*  Controls and Context Menus                  */
/* -------------------------------------------- */

Hooks.on("getSceneControlButtons", controls => {
  const notes = controls.notes;
  if ( !notes ) return;
  notes.tools.glimpse = {
    name: "glimpse",
    order: Object.keys(notes.tools).length + 1,
    title: "GLIMPSE.Toggle",
    icon: "fa-solid fa-mountain-sun",
    toggle: true,
    active: setting("enabled"),
    onChange: (event, active) => toggleEnabled(active)
  };
});

/**
 * Add Glimpse actions to the right-click menu of the V14 placeables sidebar.
 * @param {PlaceableTab} app
 * @param {ContextMenuEntry[]} options
 */
function addContextOptions(app, options) {
  const docOf = li => app._getPlaceableFromElement(li);
  const usable = doc => (doc?.documentName === "Region" ? regionEnabled(doc) : flagsOf(doc).mode !== "off");
  const undiscovered = doc => {
    const flags = flagsOf(doc);
    return ((flags.discovery ?? "known") !== "known") && !flags.visited;
  };
  options.push({
    label: "GLIMPSE.Context.Gallery",
    icon: "fa-solid fa-images",
    visible: li => usable(docOf(li)),
    onClick: (event, li) => openGallery(docOf(li))
  }, {
    label: "GLIMPSE.Context.Reveal",
    icon: "fa-solid fa-eye",
    visible: li => game.user.isGM && usable(docOf(li)),
    onClick: (event, li) => revealToPlayers(docOf(li))
  }, {
    label: "GLIMPSE.Context.MarkVisited",
    icon: "fa-solid fa-flag",
    visible: li => game.user.isGM && undiscovered(docOf(li)),
    onClick: (event, li) => docOf(li).setFlag(MODULE_ID, "visited", true)
  }, {
    label: "GLIMPSE.Context.MarkUnvisited",
    icon: "fa-regular fa-flag",
    visible: li => {
      const doc = docOf(li);
      return game.user.isGM && ((flagsOf(doc).discovery ?? "known") !== "known") && !undiscovered(doc);
    },
    onClick: (event, li) => docOf(li).setFlag(MODULE_ID, "visited", false)
  });
}

Hooks.on("getNotePlaceableContextOptions", addContextOptions);
Hooks.on("getRegionPlaceableContextOptions", addContextOptions);
