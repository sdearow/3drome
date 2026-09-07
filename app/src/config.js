/**
 * Application settings.
 *
 * Only how the application behaves — not what is designed. The design lives in a
 * project, created and edited through the interface and stored in the browser, so
 * that nothing a person draws depends on editing a source file.
 */

export const settings = {
  /**
   * Cesium ion access token.
   *
   * LEAVE THIS EMPTY. This file is tracked by git, so a token written here will be
   * committed and pushed, and a pushed credential has to be rotated rather than
   * edited out. Paste the token into the application instead; it is kept in the
   * browser on that machine only.
   *
   * The field exists for pinning a token in an unattended deployment.
   */
  ionToken: "",

  /** Opening camera, relative to the corridor rather than as absolute angles. */
  camera: { skewDeg: -52, pitchDeg: -28, rangeFactor: 1.15 },

  /** Hours used by the day/night toggle, local Rome time. */
  daylight: { dayHour: 11, nightHour: 21 },

  /** Where the map starts before a corridor exists. */
  home: { longitude: 12.4924, latitude: 41.8902, height: 1200 },
};

export default settings;
