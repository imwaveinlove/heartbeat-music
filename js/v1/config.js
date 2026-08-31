/* config.js — tuning constants and the shared namespace.
 *
 * Loaded first. Every other file hangs its module off window.RG.
 * Plain <script> files (not ES modules) so the game runs from file:// with no server.
 */
window.RG = window.RG || {};

RG.config = {
  LANES: 4,
  KEYS: ['KeyD', 'KeyF', 'KeyJ', 'KeyK'],
  KEY_LABELS: ['D', 'F', 'J', 'K'],
  // pink · lavender · mint · sky — saturated enough to read on the pale field
  LANE_COLORS: ['#ff2e88', '#b57bee', '#2fc9b8', '#5f9cff'],

  // Judgement windows in seconds either side of the note's exact time.
  WINDOWS: { perfect: 0.045, great: 0.090, good: 0.145, miss: 0.190 },
  SCORES:  { perfect: 300, great: 200, good: 100 },

  // Phone charts are a different instrument. On a keyboard four fingers rest on
  // four keys and any lane can be hit instantly; on a phone two thumbs cover four
  // lanes, so a thumb has to travel between the two lanes on its side and can
  // never hit both at once. A chart tuned for the keyboard is unplayable there.
  MOBILE: {
    npsScale: 0.65,   // two thumbs simply cannot cover as much
    handGap: 0.17     // time a thumb needs to move between its own two lanes
  },

  // Per-difficulty limits live in DIFFS; these apply to every chart.
  HOLD: {
    MIN: 0.34,           // shorter than this plays as a tap, not a hold
    MEASURE_MAX: 2.6,    // ceiling on how far sustain is measured
    RELEASE_GRACE: 0.13, // letting go this early still counts as carried
    BONUS: 220           // awarded once, on completing the tail
  },

  ANALYSIS_RATE: 22050,   // offline render rate for onset analysis
  HOP: 256,               // samples per analysis frame (~11.6ms at 22050)
  LEAD_IN: 2.2,           // seconds of empty runway before audio starts
  BASE_APPROACH: 1.7,     // seconds for a note to travel the lane at 1.0x

  // nps = target notes per second; the gaps keep a chart physically playable.
  //
  // soloHold is the setting that actually decides how hard a chart feels. With it
  // on, a tail may not overlap notes in ANY lane, so a hold is always played on its
  // own. With it off, other lanes keep firing while you hold — that is a real
  // rhythm-game technique, but it turns a casual chart into a mess.
  DIFFS: {
    easy:   { nps: 1.8, laneGap: 0.34, globalGap: 0.20,
              holdShare: 0,    holdMax: 0,   soloHold: true },
    normal: { nps: 3.0, laneGap: 0.22, globalGap: 0.12,
              holdShare: 0.12, holdMax: 1.6, soloHold: true },
    hard:   { nps: 5.0, laneGap: 0.13, globalGap: 0.07,
              holdShare: 0.20, holdMax: 2.6, soloHold: false }
  },

  // One filter per lane: kick / low-mid / high-mid / hats+cymbals.
  BAND_DEFS: [
    { type: 'lowpass',  freq: 130,  q: 0.9 },
    { type: 'bandpass', freq: 320,  q: 1.1 },
    { type: 'bandpass', freq: 1400, q: 1.1 },
    { type: 'highpass', freq: 3800, q: 0.9 }
  ]
};

// Player-adjustable settings, shared across modules.
// mobile defaults to whatever the device looks like, but stays overridable: a
// tablet with a keyboard, or a phone the player wants the denser chart on.
RG.settings = {
  diff: 'normal', speed: 1.0, offset: 0,
  mobile: (function () {
    try { return window.matchMedia('(pointer: coarse)').matches; }
    catch (e) { return false; }
  })()
};

// v1's page sits one level below songs/ now that v2 has the root, and
// js/songs.js reads this to find the built-in tracks.
RG.songsBase = '../songs/';

// The loaded song and its generated chart.
RG.song = { buffer: null, label: '', chart: null };

// Transient visual state, written by game.js and read by render.js.
RG.fx = {
  laneFlash: [0, 0, 0, 0],
  keyHeld: [false, false, false, false],
  hits: [],
  judge: null
};
