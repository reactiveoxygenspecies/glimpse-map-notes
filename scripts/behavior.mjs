import {MODULE_ID, api, setting} from "./constants.mjs";

const {BooleanField, NumberField} = foundry.data.fields;

/** Who sees the banner. The same choices as core's scrolling text behavior. */
const VISIBILITY = {GAMEMASTER: 0, OBSERVER: 1, ANYONE: 2};

/**
 * A region behavior that shows the region's Glimpse banner for a few seconds when a token enters it or starts its
 * turn there: a reminder of difficult terrain during combat, or an arrival banner when the party reaches a new land.
 * The banner shows what the region's Glimpse tab is set up with, even if hovering the region is switched off.
 */
export default class GlimpseBannerBehavior extends foundry.data.regionBehaviors.RegionBehaviorType {
  /** The behavior's type, as declared in module.json. */
  static TYPE = `${MODULE_ID}.banner`;

  /** @override */
  static LOCALIZATION_PREFIXES = ["GLIMPSE.Behavior", "BEHAVIOR.TYPES.base"];

  /** @override */
  static defineSchema() {
    const E = CONST.REGION_EVENTS;
    return {
      events: this._createEventsField({
        events: [E.TOKEN_ANIMATE_IN, E.TOKEN_TURN_START, E.TOKEN_ROUND_START],
        initial: [E.TOKEN_ANIMATE_IN]
      }),
      duration: new NumberField({required: true, nullable: false, initial: 4, min: 1, max: 30, step: 0.5}),
      visibility: new NumberField({
        required: true, nullable: false, initial: VISIBILITY.ANYONE,
        choices: Object.fromEntries(Object.entries(VISIBILITY).map(([key, value]) => {
          return [value, `BEHAVIOR.TYPES.displayScrollingText.VISIBILITY_MODES.${key}.label`];
        }))
      }),
      once: new BooleanField()
    };
  }

  /** @override */
  async _handleRegionEvent(event) {
    if ( this.once ) this.#disableAfterUse(event);
    if ( !this.#canView(event) ) return;
    await api()?.banner?.flash(this.region, this.duration);
  }

  /**
   * Should this user see the banner for this event? Mirrors core's scrolling text behavior.
   * @param {RegionEvent} event
   * @returns {boolean}
   */
  #canView(event) {
    if ( !this.parent.scene.isView || !setting("enabled") ) return false;
    if ( game.user.isGM ) return true;
    const token = event.data.token;
    if ( token.isSecret || !token.object?.visible ) return false;
    if ( this.visibility === VISIBILITY.ANYONE ) return true;
    if ( this.visibility === VISIBILITY.OBSERVER ) return token.testUserPermission(game.user, "OBSERVER");
    return false;
  }

  /**
   * Let one GM switch the behavior off after it has fired, as core's "once" option does. Animation events only reach
   * users viewing the scene, so that GM must be one of them.
   * @param {RegionEvent} event
   */
  #disableAfterUse(event) {
    const requiresView = event.name === CONST.REGION_EVENTS.TOKEN_ANIMATE_IN;
    const scene = this.parent.scene;
    const designated = game.user.isDesignated(u => u.active && u.isGM && (!requiresView
      || ((u.viewedScene === scene.id) && this.parent.includedInLevel(u.viewedLevel))));
    if ( designated ) this.parent.update({disabled: true});
  }
}
