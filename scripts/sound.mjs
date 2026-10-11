import {setting} from "./constants.mjs";

const FADE_IN = 900;
const FADE_OUT = 700;

/**
 * Plays one quiet ambient loop at a time while a location card is open.
 */
export default class GlimpseSound {

  /** @type {foundry.audio.Sound|null} */
  #sound = null;

  /** The source currently playing or loading. */
  #src = "";

  /**
   * Start the ambient loop for a location, cross-fading from whatever was playing.
   * @param {string} src
   * @param {object} [options]
   * @param {number} [options.boost=1]   Multiplier for the volume, used by the lightbox
   * @returns {Promise<void>}
   */
  async play(src, {boost=1}={}) {
    const volume = Math.min(1, (setting("soundVolume") / 100) * boost);
    if ( !src || (volume <= 0) || game.audio.locked ) return this.stop();
    if ( src === this.#src ) {
      this.#sound?.fade(volume, {duration: FADE_IN});
      return;
    }
    this.stop();
    this.#src = src;
    try {
      const sound = new foundry.audio.Sound(src, {context: game.audio.environment});
      await sound.load();
      if ( this.#src !== src ) return; // Superseded while loading
      this.#sound = sound;
      await sound.play({loop: true, volume, fade: FADE_IN});
    } catch(err) {
      console.warn(`Glimpse | Could not play ambient sound ${src}`, err);
      if ( this.#src === src ) this.#src = "";
    }
  }

  /**
   * Fade out and stop the current loop.
   */
  stop() {
    const sound = this.#sound;
    this.#sound = null;
    this.#src = "";
    if ( sound?.playing ) sound.stop({fade: FADE_OUT}).catch(() => {});
  }
}
