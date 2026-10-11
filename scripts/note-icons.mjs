import {setting} from "./constants.mjs";

/**
 * Restyles the icon of map notes on the canvas. Foundry draws every note as its symbol on a translucent dark square
 * with a square frame; these options let a world keep that look or trade it for something lighter.
 *
 * Background
 *  - "square":  Foundry's default translucent square
 *  - "circle":  a translucent disc instead of a square
 *  - "outline": no box; a soft dark outline traced around the symbol itself, so light icons stay readable
 *  - "none":    the bare symbol
 *
 * Frame
 *  - "always":  Foundry's default (dark at rest, coloured when hovered or selected)
 *  - "hover":   only while hovered, selected or highlighted
 *  - "never":   no frame at all
 */

/** Name of the container Glimpse adds to a note's control icon. */
const DECOR = "glimpseDecor";

/** Directions used to trace the outline: eight copies of the symbol, nudged around it. */
const OUTLINE_OFFSETS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

/** How much a hovered icon grows. */
const HOVER_SCALE = 1.15;

/**
 * Apply the configured style to one note. Called after every refresh of the note.
 * @param {Note} note
 */
export function styleNoteIcon(note) {
  const icon = note.controlIcon;
  if ( !icon || icon.destroyed ) return;
  const background = setting("iconBackground");
  const frame = setting("iconFrame");

  // Foundry's own square: shown only for the default style. ControlIcon redraws its shape on refresh but never
  // touches visibility, so this survives.
  icon.bg.visible = background === "square";

  // Our own background, if any.
  let decor = icon.children.find(c => c.name === DECOR);
  if ( ["circle", "outline"].includes(background) ) {
    if ( !decor ) {
      decor = new PIXI.Container();
      decor.name = DECOR;
      decor.eventMode = "none";
      icon.addChildAt(decor, 0);
    }
    drawDecor(decor, note, background);
  }
  else if ( decor ) decor.destroy({children: true});

  // Frame.
  const highlighted = note.hover || note.controlled || note.layer?.highlightObjects || note.isPreview;
  icon.border.visible = (frame === "always") || ((frame === "hover") && !!highlighted);

  // Grow while hovered.
  const scale = (setting("iconHoverGrow") && note.hover) ? HOVER_SCALE : 1;
  icon.scale.set(scale, scale);
}

/**
 * Draw (or redraw, when the size, texture or style changed) the custom background.
 * @param {PIXI.Container} decor
 * @param {Note} note
 * @param {"circle"|"outline"} style
 */
function drawDecor(decor, note, style) {
  const size = note.document.iconSize;
  const src = note.document.texture.src;
  const key = `${style}|${size}|${src}`;
  if ( decor.glimpseKey === key ) return;
  decor.glimpseKey = key;
  for ( const child of decor.removeChildren() ) child.destroy();

  if ( style === "circle" ) {
    const disc = new PIXI.Graphics();
    disc.beginFill(0x000000, 0.4);
    disc.drawCircle(size / 2, size / 2, size * 0.56);
    disc.endFill();
    decor.addChild(disc);
    return;
  }

  // Outline: black copies of the symbol around it, softened by a low alpha on the whole group.
  const texture = foundry.canvas.getTexture(src);
  if ( !texture ) {
    decor.glimpseKey = null; // Not loaded yet; try again on the next refresh
    return;
  }
  const offset = Math.max(1.5, size * 0.045);
  for ( const [dx, dy] of OUTLINE_OFFSETS ) {
    const copy = new PIXI.Sprite(texture);
    copy.tint = 0x000000;
    copy.width = copy.height = size;
    copy.position.set(dx * offset, dy * offset);
    decor.addChild(copy);
  }
  decor.alpha = 0.55;
}

/**
 * Re-style every note on the current scene, for example after a setting changed.
 */
export function restyleAllNotes() {
  if ( !canvas.ready ) return;
  for ( const note of canvas.notes.placeables ) note.renderFlags.set({refresh: true});
}
